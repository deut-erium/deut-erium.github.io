# frozen_string_literal: true

require "json"
require "uri"
require "fileutils"

module DeuteriumSite
  # Public catalog projections only. Do not read posts, checkers, or handout
  # contents here. StaticFile keeps these bytes out of Liquid and layouts.
  module ChallengeDocuments
    class InvalidCatalog < StandardError; end

    SLUG = /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/.freeze
    ARTICLE_ROUTE = %r{\A/challenges/[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*/\z}.freeze
    BASENAME = /\A[A-Za-z0-9][A-Za-z0-9._-]*\z/.freeze
    EVENT_TEXT_FIELDS = %w[id series label starts_at date_source].freeze
    SPOILER_LINKS = %w[source_url archive_url solution_url].freeze
    STATIC_NOTE = "This is a static archive. No live challenge service or runtime simulation is provided here."
    SPOILER_WARNING = "Spoilers: organizer files and upstream source, archive, or solution links may reveal answers. Modified downloads are identified below."
    DIFFECIENT_TOKEN = "ARCHIVE_DIFFECIENT_URL"

    module_function

    def invalid(message)
      raise InvalidCatalog, "challenge_documents: #{message}"
    end

    def object(value, label)
      invalid("#{label} must be an object") unless value.is_a?(Hash)
      value
    end

    def array(value, label)
      invalid("#{label} must be an array") unless value.is_a?(Array)
      value
    end

    def text(value, label, empty: false)
      unless value.is_a?(String) && value.valid_encoding? && (empty || !value.strip.empty?) &&
             !value.match?(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
        invalid("#{label} must be text without control characters")
      end
      value.dup
    end

    def integer(value, label)
      invalid("#{label} must be a nonnegative integer") unless value.is_a?(Integer) && value >= 0
      value
    end

    def digest(value, label)
      invalid("#{label} must be a SHA-256 hex digest") unless value.is_a?(String) && value.match?(/\A[0-9a-f]{64}\z/)
      value.dup
    end

    def http_url(value, label)
      value = text(value, label)
      uri = URI.parse(value)
      unless uri.is_a?(URI::HTTP) && uri.host && !uri.host.empty? && !uri.userinfo
        invalid("#{label} must be an absolute HTTP(S) URL without credentials")
      end
      value
    rescue URI::InvalidURIError
      invalid("#{label} must be an absolute HTTP(S) URL")
    end

    def origin(site)
      value = http_url(site.config["url"], "site.url").sub(%r{/+\z}, "")
      uri = URI.parse(value)
      invalid("site.url must be an HTTP(S) origin") unless uri.path.empty? && uri.query.nil? && uri.fragment.nil?
      value
    end

    def prefix(site)
      value = site.config.fetch("baseurl", "")
      value = "" if value.nil?
      invalid("unsafe site.baseurl") unless value.is_a?(String)
      return "" if value.empty? || value == "/"

      value = value.delete_suffix("/")
      segments = value.delete_prefix("/").split("/", -1)
      unless value.start_with?("/") && segments.all? { |part| part.match?(BASENAME) && !part.end_with?(".") }
        invalid("unsafe site.baseurl")
      end
      value
    end

    def article_route(value)
      invalid("unsafe entry route") unless value.is_a?(String) && value.match?(ARTICLE_ROUTE)
      value.dup
    end

    def basename(value)
      unless value.is_a?(String) && value.match?(BASENAME) && !value.end_with?(".")
        invalid("unsafe download name")
      end
      value.dup
    end

    def local_file_route(value, directory, name)
      invalid("unsafe or nonlocal file route") unless value == "#{directory}/#{name}"
      value.dup
    end

    def event_record(event)
      object(event, "event")
      result = EVENT_TEXT_FIELDS.to_h { |key| [key, text(event[key], "event.#{key}")] }
      result["date_source"] = http_url(event["date_source"], "event.date_source")
      result["year"] = integer(event["year"], "event.year")
      result
    end

    def file_record(file, id, origin, prefix, organizer: false)
      object(file, "file")
      name = basename(file["download_name"])
      route = local_file_route(file["url"], "/assets/challenges/#{id}", name)
      kinds = organizer ? %w[organizer-source] : %w[handout server-source fixed-instance]
      invalid("unexpected file kind") unless kinds.include?(file["kind"])
      result = {
        "name" => name,
        "label" => text(file.fetch("label", name), "file.label"),
        "kind" => file["kind"].dup,
        "url" => "#{origin}#{prefix}#{route}",
        "path" => "#{prefix}#{route}",
        "bytes" => integer(file["bytes"], "file.bytes"),
        "sha256" => digest(file["sha256"], "file.sha256"),
      }
      unless file["upstream_url"].nil?
        result["upstream_url"] = http_url(file["upstream_url"], "file.upstream_url")
      end
      modification_keys = %w[modification upstream_sha256 upstream_bytes]
      if modification_keys.any? { |key| file.key?(key) }
        invalid("modified files must be separate organizer downloads") unless organizer
        result["modification"] = text(file["modification"], "file.modification")
        result["upstream_sha256"] = digest(file["upstream_sha256"], "file.upstream_sha256")
        result["upstream_bytes"] = integer(file["upstream_bytes"], "file.upstream_bytes")
        invalid("modified organizer download needs upstream provenance") unless result["upstream_url"]
      end
      result
    end

    def license_records(catalog, origin, prefix)
      array(catalog.fetch("licenses", []), "licenses").each_with_object({}) do |license, result|
        object(license, "license")
        route = text(license["url"], "license.url")
        name = basename(route.split("/", -1).last)
        local_file_route(route, "/assets/challenges/licenses", name)
        invalid("duplicate license route") if result.key?(route)
        result[route] = {
          "url" => "#{origin}#{prefix}#{route}", "path" => "#{prefix}#{route}",
          "name" => text(license["name"], "license.name"),
          "bytes" => integer(license["bytes"], "license.bytes"),
          "sha256" => digest(license["sha256"], "license.sha256"),
        }
        unless license["upstream_url"].nil?
          result[route]["upstream_url"] = http_url(license["upstream_url"], "license.upstream_url")
        end
      end
    end

    def applicable_licenses(entry, licenses)
      return [] if entry["license"].nil?

      license = object(entry["license"], "entry.license")
      routes = array(license["local_urls"], "entry.license.local_urls")
      invalid("duplicate applicable license") unless routes.uniq == routes
      routes.map { |route| licenses.fetch(route) { invalid("unknown local license route") }.dup }
    end

    def records(site)
      catalog = site.data["authored_challenges"]
      return [] if catalog.nil?

      object(catalog, "catalog")
      host, base = origin(site), prefix(site)
      events = array(catalog["events"], "events").each_with_object({}) do |event, result|
        projected = event_record(event)
        id = projected.fetch("id")
        invalid("duplicate event id") if result.key?(id)
        result[id] = projected
      end
      licenses = license_records(catalog, host, base)
      entries = array(catalog["entries"], "entries")
      routes, ids = {}, {}
      entries.each do |entry|
        object(entry, "entry")
        id = entry["id"]
        invalid("unsafe entry id") unless id.is_a?(String) && id.match?(SLUG)
        route = article_route(entry["url"])
        invalid("duplicate entry id or route") if ids.key?(id) || routes.key?(route)
        ids[id], routes[route] = route, true
      end
      entries.map do |entry|
        id = entry.fetch("id")
        route = ids.fetch(id)
        event = events.fetch(entry["event_id"]) { invalid("unknown event id") }
        year = integer(entry["year"], "entry.year")
        invalid("entry year does not match event") unless year == event["year"]
        mode = entry["mode"]
        invalid("unexpected challenge mode") unless %w[offline interactive].include?(mode)
        statement = text(entry["statement"], "entry.statement", empty: true)
        if statement.include?(DIFFECIENT_TOKEN)
          diffecient = ids.fetch("sekaictf-2022-diffecient") { invalid("missing Diffecient article for statement link") }
          statement = statement.gsub(DIFFECIENT_TOKEN) { "#{host}#{base}#{diffecient}" }
        end
        files = array(entry["files"], "entry.files").map { |file| file_record(file, id, host, base) }
        spoilers = { "warning" => SPOILER_WARNING.dup, "files" => [] }
        unless entry["organizer_download"].nil?
          spoilers["files"] << file_record(entry["organizer_download"], id, host, base, organizer: true)
        end
        paths = (files + spoilers["files"]).map { |file| file["path"] }
        invalid("duplicate primary or organizer file route") unless paths.uniq == paths
        SPOILER_LINKS.each do |key|
          spoilers[key] = http_url(entry[key], key) unless entry[key].nil?
        end
        notes = array(entry["notes"], "entry.notes").map { |note| text(note, "entry note") }
        notes << STATIC_NOTE.dup unless notes.include?(STATIC_NOTE)
        {
          "id" => id.dup, "title" => text(entry["post_title"], "entry.post_title"),
          "challenge_name" => text(entry["title"], "entry.title"), "year" => year,
          "category" => text(entry["category"], "entry.category"),
          "authors" => array(entry["authors"], "entry.authors").map { |author| text(author, "author") },
          "mode" => mode.dup, "event" => event.dup,
          "article_url" => "#{host}#{base}#{route}", "article_path" => "#{base}#{route}",
          "text_url" => "#{host}#{base}#{route}challenge.txt", "text_path" => "#{base}#{route}challenge.txt",
          "json_url" => "#{host}#{base}#{route}challenge.json", "json_path" => "#{base}#{route}challenge.json",
          "statement" => { "label" => text(entry["statement_label"], "entry.statement_label"), "text" => statement },
          "notes" => notes, "files" => files, "spoilers" => spoilers,
          "licenses" => applicable_licenses(entry, licenses),
        }
      end.sort_by { |record| [-record.fetch("year"), record.fetch("challenge_name").downcase, record.fetch("id")] }
    end

    def file_lines(file)
      lines = ["- #{file.fetch('label')} (#{file.fetch('name')}; #{file.fetch('kind')})",
               "  URL: #{file.fetch('url')}", "  Bytes: #{file.fetch('bytes')}",
               "  SHA-256: #{file.fetch('sha256')}"]
      lines << "  Upstream provenance: #{file['upstream_url']}" if file["upstream_url"]
      if file["modification"]
        lines.concat(["  Modification: #{file['modification']}",
                      "  Upstream bytes: #{file.fetch('upstream_bytes')}",
                      "  Upstream SHA-256: #{file.fetch('upstream_sha256')}"])
      end
      lines
    end

    def plain_text(record)
      event = record.fetch("event")
      lines = [record.fetch("title"), "", "Challenge: #{record.fetch('challenge_name')}",
               "Event: #{event.fetch('series')} - #{event.fetch('label')}",
               "Year: #{record.fetch('year')}", "Category: #{record.fetch('category')}",
               "Authors: #{record.fetch('authors').join(', ')}", "Mode: #{record.fetch('mode')}",
               "Article: #{record.fetch('article_url')}", "Text: #{record.fetch('text_url')}",
               "JSON: #{record.fetch('json_url')}", "", "#{record.fetch('statement').fetch('label')}:",
               record.fetch("statement").fetch("text"), "", "Notes:"]
      lines.concat(record.fetch("notes").map { |note| "- #{note}" })
      lines.concat(["", "Challenge files (primary):"])
      lines << "No player handout is available in this archive." if record.fetch("files").empty?
      record.fetch("files").each { |file| lines.concat(file_lines(file)) }
      lines.concat(["", "Licenses (local copies):"])
      lines << "No local license record is available for this entry." if record.fetch("licenses").empty?
      record.fetch("licenses").each do |license|
        lines.concat(["- #{license.fetch('name')}: #{license.fetch('url')}",
                      "  Bytes: #{license.fetch('bytes')}", "  SHA-256: #{license.fetch('sha256')}"])
        lines << "  Upstream provenance: #{license['upstream_url']}" if license["upstream_url"]
      end
      spoilers = record.fetch("spoilers")
      lines.concat(["", "SPOILERS - organizer files and solutions", spoilers.fetch("warning")])
      spoilers.fetch("files").each { |file| lines.concat(file_lines(file)) }
      SPOILER_LINKS.each do |key|
        lines << "#{key.delete_suffix('_url').capitalize}: #{spoilers[key]}" if spoilers[key]
      end
      lines.join("\n") << "\n"
    end

    def json_bytes(value)
      JSON.pretty_generate(value) << "\n"
    end

    # Compare actual Jekyll destinations, including file/directory conflicts.
    # The second check at post_render catches pages added by later generators.
    def check_collisions(site, artifacts)
      writers = []
      site.each_site_file { |writer| writers << writer }
      artifacts.each do |artifact|
        target = File.expand_path(artifact.destination(site.dest)).downcase
        (writers + artifacts).each do |writer|
          next if writer.equal?(artifact)

          other = File.expand_path(writer.destination(site.dest)).downcase
          if target == other || target.start_with?(other + "/") || other.start_with?(target + "/")
            invalid("output collision at #{artifact.relative_path}")
          end
        end
        safe_destination(site.dest, artifact.destination(site.dest))
      end
    end

    def safe_destination(dest, path)
      root, target = File.expand_path(dest), File.expand_path(path)
      invalid("unsafe output destination") unless target.start_with?(root + "/")
      current = target
      loop do
        invalid("symlink output destination") if File.symlink?(current)
        if File.exist?(current)
          allowed = current == target ? File.file?(current) : File.directory?(current)
          invalid("file/directory output collision") unless allowed
        end
        break if current == root

        current = File.dirname(current)
      end
    end

    class Artifact < Jekyll::StaticFile
      def initialize(site, route, bytes)
        relative = route.delete_prefix("/")
        super(site, site.source, File.dirname(relative), File.basename(relative))
        @bytes = bytes
      end

      def write? = true

      def write(dest)
        path = destination(dest)
        ChallengeDocuments.safe_destination(dest, path)
        FileUtils.mkdir_p(File.dirname(path))
        File.binwrite(path, @bytes)
        true
      end
    end

    class Generator < Jekyll::Generator
      safe true
      priority :lowest

      def generate(site)
        return if site.data["authored_challenges"].nil?

        records = ChallengeDocuments.records(site)
        base = ChallengeDocuments.prefix(site)
        artifacts = [Artifact.new(site, "/challenges/index.json", ChallengeDocuments.json_bytes(records))]
        records.each do |record|
          artifacts << Artifact.new(site, record.fetch("json_path").delete_prefix(base), ChallengeDocuments.json_bytes(record))
          artifacts << Artifact.new(site, record.fetch("text_path").delete_prefix(base), ChallengeDocuments.plain_text(record))
        end
        ChallengeDocuments.check_collisions(site, artifacts)
        site.static_files.concat(artifacts)
      end
    end
  end
end

Jekyll::Hooks.register :site, :post_render do |site|
  documents = DeuteriumSite::ChallengeDocuments
  artifacts = site.static_files.grep(documents::Artifact)
  documents.check_collisions(site, artifacts) unless artifacts.empty?
end
