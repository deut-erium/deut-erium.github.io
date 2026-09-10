# frozen_string_literal: true

require "cgi"
require "strscan"
require "rdoc"
require "rdoc/markdown"

module DeuteriumSite
  module ArticleContents
    Uncertain = Class.new(StandardError)
    Node = Struct.new(:type, :value, :attr, :children)
    Projection = Struct.new(:output, :data)
    PENDING = "<!-- article-contents:pending -->"
    SLOT = %(<details class="record-toc" open><summary>Contents</summary><nav class="js-toc-root" data-toc-built aria-label="Table of contents">#{PENDING}</nav></details>).freeze

    # A deliberately restricted HTML reader, not an error-recovery parser.
    # Accept explicit, balanced markup; omit contents on unsupported tokenizer
    # states or tree repairs. Never serialize this tree into the article.
    class Reader
      SPACE = /[\t\n\f\r ]*/
      VOID = %w[area base br col embed hr img input link meta param source track wbr].freeze
      RAW = %w[script style textarea title iframe xmp noembed noframes].freeze
      BLOCK = %w[address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section summary table ul xmp].freeze
      HTML = (VOID + RAW + BLOCK + %w[html head body a abbr acronym b bdi bdo big button caption cite code data datalist dd del dfn dt em i ins kbd label legend li map mark meter noscript object optgroup option output picture progress q rb rp rt rtc ruby s samp select slot small span strong sub sup tbody td template tfoot th thead time tr tt u var video audio canvas dialog search]).freeze
      SVG = %w[svg g path rect circle ellipse line polyline polygon defs use symbol title desc clipPath mask linearGradient radialGradient stop].map(&:downcase).freeze
      MATH = %w[math semantics annotation mrow mi mo mn mtext mspace ms msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mpadded mphantom menclose].freeze
      TABLE = { "table" => %w[caption colgroup thead tbody tfoot], "colgroup" => %w[col], "thead" => %w[tr], "tbody" => %w[tr], "tfoot" => %w[tr], "tr" => %w[td th] }.freeze

      def self.parse(source)
        new.read(source)
      end

      def read(source)
        raise Uncertain, "HTML size or encoding" if source.bytesize > 4 * 1024 * 1024 || !source.valid_encoding? || source.include?("\0")

        @src = StringScanner.new(source.gsub(/\r\n?/, "\n"))
        root = Node.new(:root, nil, {}, [])
        @stack = [root]
        @noscript_end = nil
        until @src.eos?
          raise Uncertain, "HTML nesting limit" if @stack.length > 256
          raise Uncertain, "scripting-dependent markup" if @noscript_end && @src.pos > @noscript_end
          if @src.scan(/<!--/)
            comment = @src.scan_until(/-->/)
            raise Uncertain, "ambiguous comment" unless comment && !comment.match?(/\A(?:>|->)|<!--|--!>/)
          elsif @src.scan(/<!doctype html\s*>/i)
            raise Uncertain, "misplaced doctype" unless @stack.length == 1
          elsif @src.scan(%r{</([A-Za-z][A-Za-z0-9:-]*)[\t\n\f\r ]*>})
            raise Uncertain, "unbalanced HTML" unless @stack.length > 1 && @stack.last.value == @src[1].downcase
            @noscript_end = nil if @stack.last.value == "noscript"
            @stack.pop
          elsif @src.scan(/<([A-Za-z][A-Za-z0-9:-]*)/)
            tag = @src[1].downcase
            attrs, closed = attributes
            validate(tag, closed)
            node = Node.new(:html_element, tag, attrs, [])
            @stack.last.children << node
            if tag == "noscript"
              # With scripting on this is raw text. Its first closing token must
              # also be the balanced close when parsed with scripting off.
              prefix = @src.check(%r{.*?(?=</noscript(?=[\t\n\f\r />]))}mi)
              raise Uncertain, "unclosed noscript" unless prefix
              @noscript_end = @src.pos + prefix.bytesize
            end
            if RAW.include?(tag) && !foreign?
              raw = @src.scan_until(%r{(?=</#{tag}(?=[\t\n\f\r />]))}i)
              raise Uncertain, "unsupported raw-text state" unless raw && @src.scan(%r{</#{tag}[\t\n\f\r ]*>}i)
              raise Uncertain, "escaped script state" if tag == "script" && raw.include?("<!--")
              node.children << Node.new(%w[textarea title].include?(tag) ? :text : :raw, raw, {}, [])
            elsif !VOID.include?(tag) && !closed
              @stack << node
            end
          else
            text = @src.scan(/[^<]+/) || @src.scan(/<(?![A-Za-z!\/?])/)
            raise Uncertain, "unsupported HTML token" unless text
            raise Uncertain, "table text repair" if TABLE.key?(@stack.last.value) && !text.strip.empty?
            @stack.last.children << Node.new(:text, text, {}, [])
          end
        end
        raise Uncertain, "unclosed HTML" unless @stack.length == 1

        root
      end

      def attributes
        attrs = {}
        loop do
          space = @src.scan(SPACE)
          return [attrs, false] if @src.scan(/>/)
          return [attrs, true] if @src.scan(%r{/>})
          raise Uncertain, "unsupported attribute" if space.empty? || !@src.scan(/[A-Za-z_:][A-Za-z0-9_.:-]*/)
          name = @src.matched.downcase
          raise Uncertain, "duplicate attribute" if attrs.key?(name)
          value = ""
          if @src.scan(/[\t\n\f\r ]*=[\t\n\f\r ]*/)
            value = if @src.scan(/"([^"]*)"|'([^']*)'/m)
              @src[1] || @src[2]
            else
              @src.scan(/[^\t\n\f\r "'`=<>]+/) || (raise Uncertain, "missing attribute value")
            end
          end
          attrs[name] = value
        end
      end

      def foreign?
        @stack.any? { |node| %w[svg math].include?(node.value) }
      end

      def validate(tag, closed)
        names = @stack.map(&:value)
        parent = names.last
        if foreign?
          allowed = names.include?("svg") ? SVG : MATH
          raise Uncertain, "unsupported foreign content" unless allowed.include?(tag)
          return
        end
        raise Uncertain, "unsupported HTML element" unless (HTML + %w[colgroup svg math]).include?(tag) || tag.include?("-")
        raise Uncertain, "HTML self-closing repair" if closed && !VOID.include?(tag) && !%w[svg math].include?(tag)
        raise Uncertain, "paragraph repair" if names.include?("p") && BLOCK.include?(tag)
        raise Uncertain, "heading repair" if tag.match?(/\Ah[1-6]\z/) && names.any? { |name| name&.match?(/\Ah[1-6]\z/) }
        raise Uncertain, "nested interactive element" if %w[a button form noscript].include?(tag) && names.include?(tag)
        if tag == "li" && names.reverse.find { |name| %w[li ul ol menu].include?(name) } == "li"
          raise Uncertain, "list repair"
        end
        if %w[dt dd].include?(tag) && %w[dt dd].include?(names.reverse.find { |name| %w[dt dd dl].include?(name) })
          raise Uncertain, "description list repair"
        end
        raise Uncertain, "table repair" if TABLE.key?(parent) && !TABLE[parent].include?(tag)
        if (TABLE.values.flatten + %w[colgroup]).include?(tag) && !TABLE.fetch(parent, []).include?(tag)
          raise Uncertain, "table context"
        end
        raise Uncertain, "select repair" if names.include?("select") && !%w[option optgroup].include?(tag)
        raise Uncertain, "option repair" if %w[option optgroup].include?(tag) && names.include?(tag)
        raise Uncertain, "document repair" if %w[html head body].include?(tag) && (names.include?(tag) || (tag == "html" ? parent : parent != "html"))
        raise Uncertain, "head repair" if parent == "head" && !%w[base link meta title style script noscript template].include?(tag)
      end
    end

    # JavaScript textContent.trim(), including NBSP and BOM.
    EDGE_SPACE = /\A[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+\z/.freeze
    REFERENCE = /&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[A-Za-z][A-Za-z0-9]*;?)/.freeze
    ENTITY = /\A&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));\z/.freeze

    module_function

    def decode(text)
      text.gsub(REFERENCE) do |reference|
        raise Uncertain, "character reference length" if reference.length > 128
        match = ENTITY.match(reference)
        if !match || (match[3] && !RDoc::Markdown::HTML_ENTITIES.key?(match[3]))
          # Unknown names can still contain a legacy semicolonless prefix
          # (e.g. &notit;). Do not guess at text/attribute recovery rules.
          name = reference.delete_prefix("&").delete_suffix(";")
          ambiguous = name.start_with?("#") || (1..name.length).any? { |n| RDoc::Markdown::HTML_ENTITIES.key?(name[0, n]) }
          raise Uncertain, "ambiguous character reference" if ambiguous
          next reference
        end
        decimal, hex, name = match.captures
        next RDoc::Markdown::HTML_ENTITIES.fetch(name).pack("U*") if name

        point = (decimal || hex).to_i(decimal ? 10 : 16)
        point = 0xFFFD if point.zero? || point > 0x10FFFF || (0xD800..0xDFFF).cover?(point)
        if (0x80..0x9F).cover?(point)
          begin
            next point.chr(Encoding::Windows_1252).encode(Encoding::UTF_8)
          rescue Encoding::UndefinedConversionError
            # Undefined Windows-1252 bytes retain their control codepoint.
          end
        end
        [point].pack("U")
      end
    end

    def text_content(element)
      return decode(element.value) if element.type == :text
      return element.value if element.type == :raw
      return "" if element.value == "template"
      raise Uncertain, "scripting-dependent label" if element.value == "noscript"
      raise Uncertain, "preformatted label" if element.value == "pre"

      text = element.children.map { |child| text_content(child) }.join
      element.value == "textarea" ? text.delete_prefix("\n") : text
    end

    def elements(root, result = [], skip_noscript: false)
      root.children.each do |child|
        next unless child.type == :html_element
        result << child
        # Include noscript IDs in uniqueness: these exist without JavaScript.
        next if child.value == "template" || (skip_noscript && child.value == "noscript")
        elements(child, result, skip_noscript: skip_noscript)
      end
      result
    end

    def fragment(id)
      id.encode(Encoding::UTF_8).bytes.map do |byte|
        char = byte.chr
        char.match?(/[A-Za-z0-9_.!~*'()-]/) ? char : format("%%%02X", byte)
      end.join.prepend("#")
    end

    def render_page(html)
      root = Reader.parse(html)
      nodes = elements(root)
      raise Uncertain, "base URL changes fragment navigation" if nodes.any? { |node| node.value == "base" }
      ids = nodes.filter_map { |node| decode(node.attr["id"]) if node.attr.key?("id") }.tally
      articles = nodes.select { |node| node.value == "article" && node.attr["id"] == "article-body" }
      return "" unless articles.length == 1

      items = elements(articles.first, skip_noscript: true).filter_map do |node|
        next unless %w[h2 h3 h4].include?(node.value) && node.attr.key?("id")
        id = decode(node.attr["id"])
        next if id.empty? || ids[id] != 1
        begin
          title = text_content(node).gsub(EDGE_SPACE, "")
        rescue Uncertain
          next # An uncertain label cannot affect another heading's target.
        end
        next if title.empty?
        %(<li class="toc-#{node.value}"><a href="#{CGI.escapeHTML(fragment(id))}">#{CGI.escapeHTML(title)}</a></li>)
      end
      items.empty? ? "" : "<ol>#{items.join}</ol>"
    end

    def finalize(document)
      return unless document.data["layout"] == "article" && document.output_ext == ".html" && document.output.include?(SLOT)

      begin
        contents = render_page(document.output)
      rescue Uncertain => error
        Jekyll.logger.warn "Article contents:", "omitted (#{error.message})"
        contents = ""
      end
      replacement = contents.empty? ? "" : SLOT.sub(PENDING, contents)
      # Only the layout's pending disclosure is replaced. No article, heading,
      # code, ID, or unrelated navigation is reserialized or rewritten.
      # The layout slot follows the article. An identical literal inside authored
      # HTML (including a script string) must not be treated as the layout slot.
      offset = document.output.rindex(SLOT)
      document.output = document.output.dup
      document.output[offset, SLOT.length] = replacement
    end
  end

  module ArticleContentsFilter
    def article_contents(_html, _section = nil)
      ArticleContents::PENDING
    end
  end
end

Liquid::Template.register_filter(DeuteriumSite::ArticleContentsFilter)
# Low priority runs after the existing heading normalizations and code frames,
# irrespective of alphabetical plugin load order. Read the complete layout.
Jekyll::Hooks.register [:documents, :pages], :post_render, priority: :low do |document|
  DeuteriumSite::ArticleContents.finalize(document)
end
