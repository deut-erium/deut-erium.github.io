# frozen_string_literal: true

require "digest"
require "pathname"

module DeuteriumSite
  module LegacyPaths
    class ManifestError < StandardError; end

    module_function

    def relative_path(value, label)
      raise ManifestError, "#{label} must be a string" unless value.is_a?(String)
      raise ManifestError, "#{label} is empty" if value.empty?
      raise ManifestError, "#{label} contains a control character" if value.match?(/[[:cntrl:]]/)
      raise ManifestError, "#{label} must use forward slashes" if value.include?("\\")
      raise ManifestError, "#{label} must be relative" if value.start_with?("/")

      parts = value.split("/", -1)
      if parts.any? { |part| part.empty? || part == "." || part == ".." }
        raise ManifestError, "#{label} is not a clean relative path: #{value.inspect}"
      end
      value
    end

    def baseurl(site)
      value = site.baseurl.to_s
      return "" if value.empty?

      unless value.start_with?("/") && !value.end_with?("/") && !value.include?("..")
        raise ManifestError, "baseurl must be empty or a clean absolute path"
      end
      value
    end

    def public_url(site, target)
      Jekyll::URL.escape_path("#{baseurl(site)}/#{target}")
    end

    def canonical_url(site, target)
      origin = site.config.fetch("url", "").to_s.sub(%r{/+\z}, "")
      unless origin.match?(%r{\Ahttps?://[^/]+\z})
        raise ManifestError, "site.url must be an HTTP(S) origin"
      end
      "#{origin}#{public_url(site, target)}"
    end

    class AliasPage < Jekyll::PageWithoutAFile
      def initialize(site, path, target_document)
        super(site, site.source, File.dirname(path), File.basename(path))
        target_path = target_document.url.delete_prefix("/")
        destination = LegacyPaths.public_url(site, target_path)
        self.content = ""
        self.data = {
          "layout" => "redirect",
          "title" => "Record moved",
          "description" => "This historical URL now points to #{target_document.data["title"]}.",
          "target_title" => target_document.data["title"],
          "redirect_to" => destination,
          "canonical_url" => LegacyPaths.canonical_url(site, target_path),
          "noindex" => true,
          "sitemap" => false,
          "legacy_alias" => true,
        }
      end
    end

    class Attachment < Jekyll::StaticFile
      attr_reader :legacy_path

      def initialize(site, source_path, legacy_path)
        source = Pathname.new(source_path)
        super(site, site.source, source.dirname.to_s, source.basename.to_s)
        @legacy_path = legacy_path
      end

      def destination(dest)
        @legacy_destinations ||= {}
        @legacy_destinations[dest] ||= @site.in_dest_dir(dest, legacy_path)
      end

      def url
        @legacy_url ||= "/#{Jekyll::URL.escape_path(legacy_path)}"
      end
    end

    class Generator < Jekyll::Generator
      safe true
      priority :low

      def generate(site)
        manifest = site.data.fetch("legacy_paths") do
          raise ManifestError, "_data/legacy_paths.json is missing"
        end
        raise ManifestError, "unsupported legacy manifest version" unless manifest["version"] == 1

        aliases = manifest.fetch("aliases")
        attachments = manifest.fetch("attachments")
        validate_collections(aliases, attachments)

        documents = site.posts.docs.to_h do |document|
          [document.url.delete_prefix("/").delete_suffix(".html"), document]
        end
        occupied = existing_destinations(site)

        aliases.sort_by { |row| row.fetch("path") }.each do |row|
          path = LegacyPaths.relative_path(row.fetch("path"), "legacy alias path")
          target = LegacyPaths.relative_path(row.fetch("target"), "legacy alias target")
          raise ManifestError, "legacy alias must end in .html: #{path}" unless path.end_with?(".html")
          raise ManifestError, "legacy alias target must be extensionless: #{target}" if target.end_with?(".html")
          target_document = documents[target]
          raise ManifestError, "legacy alias target does not exist: #{target}" unless target_document

          destination = site.in_dest_dir(site.dest, path)
          reserve!(occupied, destination, path)
          site.pages << AliasPage.new(site, path, target_document)
        end

        attachments.sort_by { |row| row.fetch("path") }.each do |row|
          path = LegacyPaths.relative_path(row.fetch("path"), "legacy attachment path")
          source = LegacyPaths.relative_path(row.fetch("source"), "legacy attachment source")
          unless source.start_with?("_posts/", "_legacy_blobs/")
            raise ManifestError, "legacy attachment source is outside the approved roots: #{source}"
          end

          source_path = site.in_source_dir(source)
          verify_source!(source_path, row, path)
          destination = site.in_dest_dir(site.dest, path)
          reserve!(occupied, destination, path)
          site.static_files << Attachment.new(site, source, path)
        end
      rescue KeyError => error
        raise ManifestError, "legacy manifest field is missing: #{error.message}"
      end

      private

      def validate_collections(aliases, attachments)
        unless aliases.is_a?(Array) && attachments.is_a?(Array)
          raise ManifestError, "legacy aliases and attachments must be arrays"
        end
        paths = aliases.map { |row| row["path"] } + attachments.map { |row| row["path"] }
        duplicates = paths.group_by(&:itself).select { |_, rows| rows.length > 1 }.keys
        raise ManifestError, "duplicate legacy paths: #{duplicates.join(", ")}" unless duplicates.empty?
      end

      def existing_destinations(site)
        pages = site.pages.map { |page| page.destination(site.dest) }
        documents = site.posts.docs.map { |document| document.destination(site.dest) }
        static_files = site.static_files.map { |file| file.destination(site.dest) }
        (pages + documents + static_files).to_h { |path| [File.expand_path(path), true] }
      end

      def reserve!(occupied, destination, label)
        expanded = File.expand_path(destination)
        raise ManifestError, "legacy path collides with generated output: #{label}" if occupied[expanded]

        occupied[expanded] = true
      end

      def verify_source!(source_path, row, label)
        raise ManifestError, "legacy attachment source is missing: #{source_path}" unless File.file?(source_path)

        expected_size = Integer(row.fetch("bytes"))
        actual_size = File.size(source_path)
        unless actual_size == expected_size
          raise ManifestError, "legacy attachment size drift for #{label}: #{actual_size} != #{expected_size}"
        end

        expected_hash = row.fetch("sha256")
        unless expected_hash.is_a?(String) && expected_hash.match?(/\A[0-9a-f]{64}\z/)
          raise ManifestError, "invalid SHA-256 for legacy attachment: #{label}"
        end
        actual_hash = Digest::SHA256.file(source_path).hexdigest
        unless actual_hash == expected_hash
          raise ManifestError, "legacy attachment hash drift for #{label}: #{actual_hash} != #{expected_hash}"
        end
      rescue ArgumentError, TypeError
        raise ManifestError, "invalid byte count for legacy attachment: #{label}"
      end
    end
  end
end
