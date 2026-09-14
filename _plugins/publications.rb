# frozen_string_literal: true

require "date"
require "digest"
require "fileutils"
require "json"
require "uri"

module DeuteriumSite
  module Publications
    class InvalidPublication < StandardError; end

    LATEX = {
      "\\" => '\\textbackslash{}', "{" => '\\textbraceleft{}', "}" => '\\textbraceright{}',
      "%" => '\\%', "&" => '\\&', "_" => '\\_', "#" => '\\#', "$" => '\\$',
      "~" => '\\textasciitilde{}', "^" => '\\textasciicircum{}',
    }.freeze
    LATEX_PATTERN = Regexp.union(LATEX.keys).freeze
    PRIVATE_FLAGS = %w[hidden unlisted noindex redirect redirect_to locked].freeze

    module_function

    def invalid(message)
      raise InvalidPublication, "publications: #{message}"
    end

    def eligible?(post)
      data = post.data
      %w[article writeup].include?(data["layout"]) && data["sitemap"] != false &&
        data["published"] != false && PRIVATE_FLAGS.none? { |key| data[key] && data[key] != false }
    end

    # Validate explicit permalinks too: Jekyll normalizes '../' and '//' in .url.
    # Decode once for destination checks; reject nested encoding and separators
    # so a renderer or web server cannot interpret a different output path.
    def decoded_path(value)
      unless value.is_a?(String) && value.valid_encoding? && value.start_with?("/") && value != "/" &&
             !value.match?(%r{[^A-Za-z0-9/._~!$&'()*+,;=:@%\-]}) &&
             !value.match?(/%(?![0-9a-f]{2})/i) && !value.match?(/%(?:2f|5c)/i)
        invalid("invalid site-relative URL: #{value.inspect}")
      end
      decoded = Jekyll::URL.unescape_path(value)
      invalid("invalid UTF-8 URL: #{value.inspect}") unless decoded.valid_encoding?
      segments = decoded.split("/", -1)[1..]
      segments.pop if segments.last == ""
      if decoded.match?(/[[:cntrl:]\\%?#]/) ||
         segments.any? { |part| part.empty? || [".", ".."].include?(part) }
        invalid("unsafe URL path: #{value.inspect}")
      end
      decoded
    end

    def sibling(url, extension)
      decoded_path(url)
      path = url.sub(/(?:\.html|\/)\z/, "") + extension
      decoded_path(path)
      path
    end

    def origin(site)
      value = site.config["url"].to_s.delete_suffix("/")
      uri = URI.parse(value)
      unless %w[http https].include?(uri.scheme) && uri.host && !uri.host.empty? &&
             uri.path.empty? && !uri.userinfo && !uri.query && !uri.fragment
        invalid("site.url must be an HTTP(S) origin")
      end
      value
    rescue URI::InvalidURIError
      invalid("site.url must be an HTTP(S) origin")
    end

    def baseurl(site)
      value = site.config["baseurl"].to_s
      return "" if value.empty? || value == "/"

      decoded_path(value)
      value.delete_suffix("/")
    end

    def text(value)
      value.to_s.gsub(/[[:space:]]+/, " ").strip
    end

    def author(value)
      case value
      when Array then value.map { |item| author(item) }.reject(&:empty?).join(" and ")
      when Hash then text(value["name"] || value["display_name"])
      else text(value)
      end
    end

    def iso_date(value)
      if value.respond_to?(:strftime)
        date = value.strftime("%Y-%m-%d")
      else
        string = value.to_s
        invalid("invalid publication date: #{string.inspect}") unless string.match?(/\A\d{4}-\d{2}-\d{2}(?:\z|T)/)
        parsed = string.include?("T") ? DateTime.iso8601(string) : Date.iso8601(string)
        date = parsed.strftime("%Y-%m-%d")
      end
      invalid("invalid publication date: #{value.inspect}") unless date.match?(/\A\d{4}-\d{2}-\d{2}\z/)
      date
    rescue Date::Error
      invalid("invalid publication date: #{value.inspect}")
    end

    def latex(value)
      # One pass: never re-escape the braces/backslashes introduced by a macro.
      # Text brace macros also keep BibTeX balanced for an unmatched literal '{'.
      text(value).gsub(LATEX_PATTERN) { |character| LATEX.fetch(character) }
    end

    def bibtex(record, publication_date, date_note)
      fields = {
        "title" => "{#{latex(record.fetch('title'))}}",
        "author" => latex(record.fetch("author")),
        "howpublished" => latex("Online: #{record.fetch('canonical_url')}"),
        "url" => latex(record.fetch("canonical_url")),
      }
      if publication_date
        fields["year"] = publication_date[0, 4]
        fields["date"] = publication_date
      end
      fields["note"] = latex(date_note) if date_note
      key = "post-#{Digest::SHA256.hexdigest(record.fetch('url'))}"
      "@misc{#{key},\n" + fields.map { |name, value| "  #{name} = {#{value}}" }.join(",\n") + "\n}\n"
    end

    def metadata(site, post, prefix)
      decoded_path(post.data["permalink"]) if post.data["permalink"]
      url = post.url
      decoded_path(url)
      explicit_date = post.data["publication_date"] || post.data["published_at"]
      date = iso_date(explicit_date || post.date)
      # Authored challenge posts are dated by the event. Do not turn that date
      # into a claim about when this author published the accompanying article.
      publication_date = date unless post.data["challenge_id"] && !explicit_date
      date_note = "Challenge event began #{date}; article publication date not recorded." unless publication_date
      record = {
        "url" => url,
        "pdf_url" => sibling(url, ".pdf"),
        "bib_url" => sibling(url, ".bib"),
        "canonical_url" => prefix + url,
        "title" => text(post.data["title"]),
        "author" => author(post.data["author"] || site.config["author"]),
        "date" => date,
        "description" => text(post.data["description"]),
      }
      record.merge("publication_date" => publication_date, "date_note" => date_note,
                   "bibtex" => bibtex(record, publication_date, date_note))
    end

    def safe_destination(dest, target)
      root, path = File.expand_path(dest), File.expand_path(target)
      invalid("unsafe output destination") unless path.start_with?(root + "/")
      current = path
      loop do
        invalid("symlink output destination: #{current}") if File.symlink?(current)
        if File.exist?(current)
          allowed = current == path ? File.file?(current) : File.directory?(current)
          invalid("file/directory output collision: #{current}") unless allowed
        end
        break if current == root

        current = File.dirname(current)
      end
    end

    # PDF paths are reserved even in ordinary builds. No PDF placeholder is
    # written; the external renderer owns the bytes after Jekyll has finished.
    def check_collisions(site, reservations)
      writers = []
      site.each_site_file { |writer| writers << writer }
      outputs = (writers + reservations).uniq.map do |writer|
        [writer, File.expand_path(writer.destination(site.dest)).downcase]
      end
      reservations.each do |artifact|
        target = File.expand_path(artifact.destination(site.dest)).downcase
        outputs.each do |writer, other|
          next if writer.equal?(artifact)
          if target == other || target.start_with?(other + "/") || other.start_with?(target + "/")
            invalid("output collision at #{artifact.url}")
          end
        end
        safe_destination(site.dest, artifact.destination(site.dest))
      end
    end

    def validate(site)
      state = site.instance_variable_get(:@deuterium_publications)
      return unless state

      posts, reservations = state
      current = site.posts.docs.select { |post| eligible?(post) }.map { |post| [post, post.url] }
      invalid("eligible posts changed after generation") unless current == posts
      # A later generator may clone a post into an ordinary page. Such pages
      # must not inherit citation metadata or advertise a reserved PDF.
      nonposts = site.pages + site.collections.values.reject { |collection| collection == site.posts }.flat_map(&:docs)
      nonposts.each { |item| item.data["publication"] = nil }
      check_collisions(site, reservations)
    end

    module Filters
      # jekyll-seo-tag otherwise calls every post's event date datePublished.
      # Keep its other metadata, and preserve an explicitly known modification
      # date. Do not change ordinary posts that use their normal post date.
      def publication_seo_dates(html, page)
        publication = page["publication"]
        return html unless publication && (page["challenge_id"] || page["publication_date"] || page["published_at"])

        date = publication["publication_date"]
        modified_known = page["last_modified_at"] || (page["seo"] || {})["date_modified"]
        html = html.gsub(%r{<meta property="article:(published|modified)_time"[^>]*>}) do |tag|
          kind = Regexp.last_match(1)
          next tag if kind == "modified" && modified_known

          date ? %(<meta property="article:#{kind}_time" content="#{date}" />) : ""
        end
        html.gsub(%r{(<script type="application/ld\+json">)(.*?)(</script>)}m) do
          opening, body, closing = Regexp.last_match.captures
          data = JSON.parse(body)
          date ? data["datePublished"] = date : data.delete("datePublished")
          unless modified_known
            date ? data["dateModified"] = date : data.delete("dateModified")
          end
          opening + JSON.generate(data) + closing
        end
      end
    end

    class Artifact < Jekyll::StaticFile
      def initialize(site, route, bytes = nil)
        Publications.decoded_path(route)
        relative = route.delete_prefix("/")
        super(site, site.source, File.dirname(relative), File.basename(relative))
        @bytes = bytes
      end

      def write? = true

      def write(dest)
        Publications.invalid("attempted to write a reserved PDF") unless @bytes
        path = destination(dest)
        Publications.safe_destination(dest, path)
        FileUtils.mkdir_p(File.dirname(path))
        File.binwrite(path, @bytes)
        true
      end
    end

    class Generator < Jekyll::Generator
      safe true
      priority :lowest

      def generate(site)
        site.static_files.reject! { |file| file.is_a?(Artifact) }
        site.instance_variable_set(:@deuterium_publications, nil)
        # Front matter cannot opt standalone pages or other collections into UI.
        (site.pages + site.collections.values.flat_map(&:docs)).each { |item| item.data["publication"] = nil }
        prefix = Publications.origin(site) + Publications.baseurl(site)
        posts = site.posts.docs.select { |post| Publications.eligible?(post) }
        metadata = posts.to_h { |post| [post, Publications.metadata(site, post, prefix)] }
        records = metadata.values.sort_by { |data| data.fetch("url") }.map do |data|
          data.reject { |key, _| %w[bibtex].include?(key) }
        end
        manifest = { "version" => 1, "baseurl" => Publications.baseurl(site), "posts" => records }
        artifacts = [Artifact.new(site, "/publications.json", JSON.pretty_generate(manifest) + "\n")]
        metadata.each_value { |data| artifacts << Artifact.new(site, data.fetch("bib_url"), data.fetch("bibtex")) }
        reservations = artifacts + records.map { |data| Artifact.new(site, data.fetch("pdf_url")) }
        Publications.check_collisions(site, reservations)
        metadata.each { |post, data| post.data["publication"] = data }
        site.static_files.concat(artifacts)
        site.instance_variable_set(:@deuterium_publications, [posts.map { |post| [post, post.url] }, reservations])
      end
    end
  end
end

Liquid::Template.register_filter(DeuteriumSite::Publications::Filters)

# Later generators/hooks must not silently overwrite these public artifacts.
Jekyll::Hooks.register :site, :pre_render, priority: :low do |site|
  DeuteriumSite::Publications.validate(site)
end
Jekyll::Hooks.register :site, :post_render, priority: :low do |site|
  DeuteriumSite::Publications.validate(site)
end
