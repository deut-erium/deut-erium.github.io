# frozen_string_literal: true

# Generates /.well-known/security.txt (RFC 9116) at build time.
#
# Expires is always computed at build time (build clock + one year), so every
# release ships a fresh date and the field can never go stale in the source
# tree. The Encryption (PGP) field is intentionally absent until a key exists.
module DeuteriumSite
  module SecurityTxt
    RELATIVE_DESTINATION = ".well-known/security.txt"
    CONTACT = "mailto:himanshu_sheoran@yahoo.com"
    PREFERRED_LANGUAGES = "en"
    YEAR_SECONDS = 365 * 24 * 60 * 60

    module_function

    def canonical(site)
      origin = site.config.fetch("url", "").to_s.sub(%r{/+\z}, "")
      "#{origin}/#{RELATIVE_DESTINATION}"
    end

    def expires_at(build_time)
      (build_time + YEAR_SECONDS).utc
    end

    def render(site, build_time)
      expires = expires_at(build_time).strftime("%Y-%m-%dT%H:%M:%SZ")
      <<~TEXT
        # deuterium's blog security policy (RFC 9116).
        # No bug bounty, only gratitude and a fix.
        Contact: #{CONTACT}
        Expires: #{expires}
        Preferred-Languages: #{PREFERRED_LANGUAGES}
        Canonical: #{canonical(site)}
        Policy: #{origin_of(site)}/about.html
      TEXT
    end

    def origin_of(site)
      site.config.fetch("url", "").to_s.sub(%r{/+\z}, "")
    end

    class GeneratedFile < Jekyll::StaticFile
      def initialize(site, relative_destination, content)
        super(site, site.source, File.dirname(relative_destination), File.basename(relative_destination))
        @content = content
      end

      # StaticFile normally copies a source file; this one is generated.
      def write(dest)
        path = destination(dest)
        FileUtils.mkdir_p(File.dirname(path))
        File.binwrite(path, @content)
        true
      end
    end

    class Generator < Jekyll::Generator
      safe true
      priority :low

      def generate(site)
        build_time = site.time.is_a?(Time) ? site.time : Time.now
        site.static_files << GeneratedFile.new(
          site,
          RELATIVE_DESTINATION,
          SecurityTxt.render(site, build_time)
        )
      end
    end
  end
end
