# frozen_string_literal: true

require "digest"

module DeuteriumSite
  class LegacyProfilePage < Jekyll::PageWithoutAFile
    SOURCE = "_legacy_authored/root-assets-body.html"
    EXPECTED_SHA256 = "be52460ccb6a9df1f6c0e0d7278878a2aca3c2c1718886ac93972e6ca81679d0"

    def initialize(site)
      super(site, site.source, "assets", "index.html")
      source_path = site.in_source_dir(SOURCE)
      source = File.binread(source_path)
      actual = Digest::SHA256.hexdigest(source)
      raise "legacy profile source drift: #{actual}" unless actual == EXPECTED_SHA256

      body = source.force_encoding(Encoding::UTF_8)
      body = body.gsub(/\s+id="textbox"/, "")
      body = body.sub(%r{</header>\s*(?:<br>){4}}, "</header>")
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
