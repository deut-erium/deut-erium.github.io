# frozen_string_literal: true

require "cgi"
require "kramdown"
require "kramdown/parser/html"
require "rdoc"
require "rdoc/markdown"

module DeuteriumSite
  module ArticleContents
    # Use Jekyll's existing HTML parser, without its HTML-to-Markdown conversion
    # (which collapses whitespace and rewrites code/math nodes). Never serialize
    # this tree back into the article.
    class Reader < Kramdown::Parser::Html
      RAW_ELEMENTS = %w[script style textarea title iframe xmp noembed noframes].freeze
      TAG_OR_COMMENT = /<!--.*?-->|<\/?[A-Za-z][^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*>/m.freeze
      ATTRIBUTE_VALUE = /[^\s"'<>\/=]+\s*=\s*(?:"[^"]*"|'[^']*'|([^\s"'`=<>]+))/.freeze

      def parse
        @stack, @tree = [], @root
        # Kramdown accepts only word characters in bare attributes. Quote valid
        # HTML bare values in a parser-only copy; leave comments/raw text alone.
        raw = nil
        normalized = source.gsub(TAG_OR_COMMENT) do |token|
          tag = token[/\A<\/?([A-Za-z][\w:-]*)/, 1]&.downcase
          if raw
            raw = nil if token.match?(%r{\A</#{raw}\s*>}i)
            next token
          end
          next token unless tag && !token.start_with?("</")

          raw = tag if RAW_ELEMENTS.include?(tag)
          token.gsub(ATTRIBUTE_VALUE) do |attribute|
            bare = Regexp.last_match(1)
            bare ? attribute[0...-bare.length] + %Q("#{bare}") : attribute
          end
        end
        @src = Kramdown::Utils::StringScanner.new(adapt_source(normalized))
        handler = lambda do |element, closed, handle_body|
          if !closed && handle_body
            if %w[textarea title iframe xmp noembed noframes].include?(element.value)
              handle_raw_html_tag(element.value)
            else
              parse_raw_html(element, &handler)
            end
          end
        end
        parse_raw_html(@tree, &handler)
      end
    end

    # String#strip differs from JavaScript's textContent.trim(), notably for NBSP.
    EDGE_SPACE = /\A[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+\z/.freeze
    ENTITY = /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]+));/.freeze
    Projection = Struct.new(:output, :data)

    module_function

    def decode(text)
      text.gsub(ENTITY) do |reference|
        decimal, hex, name = Regexp.last_match.captures
        if name
          # Ruby's standard-library table includes multi-codepoint HTML5 names;
          # kramdown's table reduces some of these to a single codepoint.
          RDoc::Markdown::HTML_ENTITIES[name]&.pack("U*") || reference
        else
          point = (decimal || hex).to_i(decimal ? 10 : 16)
          point = 0xFFFD if point.zero? || point > 0x10FFFF || (0xD800..0xDFFF).cover?(point)
          if (0x80..0x9F).cover?(point)
            # HTML numeric references in this range use Windows-1252, not C1.
            begin
              next point.chr(Encoding::Windows_1252).encode(Encoding::UTF_8)
            rescue Encoding::UndefinedConversionError
              # Undefined Windows-1252 bytes retain their control codepoint.
            end
          end
          [point].pack("U")
        end
      end
    end

    def text_content(element)
      case element.type
      when :text then decode(element.value)
      when :raw then element.value
      when :xml_comment, :xml_pi then ""
      else
        return "" if element.value == "template"
        if %w[textarea title].include?(element.value)
          return decode(element.children.map(&:value).join)
        end

        element.children.map { |child| text_content(child) }.join
      end
    end

    def elements(root, result = [])
      root.children.each do |child|
        next unless child.type == :html_element
        result << child
        # Template contents are not in the document; noscript descendants also
        # disappear when scripting is enabled. The containers' own IDs count.
        elements(child, result) unless %w[template noscript].include?(child.value)
      end
      result
    end

    # Match encodeURIComponent, not form encoding: spaces are %20, never '+'.
    def fragment(id)
      id.encode(Encoding::UTF_8).bytes.map do |byte|
        char = byte.chr
        char.match?(/[A-Za-z0-9_.!~*'()-]/) ? char : format("%%%02X", byte)
      end.join.prepend("#")
    end

    def render(html, section)
      # These existing post-render rules restore/clamp heading levels. Apply the
      # same rules to a disposable projection so toc-hN matches the published
      # heading, including h5/h6 that become h2-h4. The input stays byte-identical.
      projection = Projection.new(%(<main id="content"><article id="article-body">#{html}</article></main>), { "section" => section })
      RenderCompatibility.restore_heading_levels(projection)
      RenderCompatibility.normalize_heading_outline(projection)
      root, warnings = Reader.parse(projection.output)
      # Kramdown is not an HTML5 error-recovery parser. Omit contents rather than
      # publish guessed targets when the rendered fragment cannot be parsed.
      return "" unless warnings.empty?

      nodes = elements(root)
      ids = nodes.filter_map { |node| decode(node.attr["id"]) if node.attr.key?("id") }.tally
      items = nodes.filter_map do |node|
        next unless %w[h2 h3 h4].include?(node.value) && node.attr.key?("id")

        id = decode(node.attr["id"])
        title = text_content(node).gsub(EDGE_SPACE, "")
        # Never rename IDs or link to an ambiguous target, even when a duplicate
        # belongs to a non-heading. Empty labels are not useful navigation.
        next if id.empty? || ids[id] != 1 || title.empty?

        %(<li class="toc-#{node.value}"><a href="#{CGI.escapeHTML(fragment(id))}">#{CGI.escapeHTML(title)}</a></li>)
      end
      items.empty? ? "" : "<ol>#{items.join}</ol>"
    end
  end

  module ArticleContentsFilter
    def article_contents(html, section = nil)
      ArticleContents.render(html.to_s, section)
    end
  end
end

Liquid::Template.register_filter(DeuteriumSite::ArticleContentsFilter)
