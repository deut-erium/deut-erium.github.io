# frozen_string_literal: true

require "digest"

module DeuteriumSite
  class LegacyProfilePage < Jekyll::PageWithoutAFile
    SOURCE = "_legacy_authored/root-assets-index.html"
    EXPECTED_SHA256 = "012fbad06e13a8114f080221629a096114e1fc1e515a8832c55cdedf17dd953e"

    def initialize(site)
      super(site, site.source, "assets", "index.html")
      source_path = site.in_source_dir(SOURCE)
      source = File.binread(source_path)
      actual = Digest::SHA256.hexdigest(source)
      raise "legacy profile source drift: #{actual}" unless actual == EXPECTED_SHA256

      body = source.force_encoding(Encoding::UTF_8)[/<body>(.*)<\/body>/m, 1]
      raise "legacy profile body is missing" unless body

      body = body.gsub(/\s+id="textbox"/, "")
      body = body.gsub(/href\s*=\s*"Circle-limit-IV\.jpg"/, 'href="/Circle-limit-IV.jpg"')
      self.content = %(<div class="legacy-profile">#{body}</div>)
      self.data = {
        "layout" => "page",
        "title" => "Himanshu Sheoran",
        "description" => "The original manual-page profile retained at its historical address.",
        "permalink" => "/assets/index.html",
        "canonical_url" => "#{site.config.fetch("url")}/assets/index.html",
        "noindex" => true,
        "sitemap" => false,
      }
    end
  end

  class LegacyProfileGenerator < Jekyll::Generator
    safe true
    priority :low

    def generate(site)
      site.pages << LegacyProfilePage.new(site)
    end
  end
end
