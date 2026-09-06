# frozen_string_literal: true

# Content-versioned asset URLs. Every build stamps local css/js references
# with a short content hash, so a changed asset always gets a fresh URL and
# no browser or CDN can serve yesterday's stylesheet against today's HTML.
module Jekyll
  module AssetVersionFilter
    def asset_v(path = nil)
      site = @context.registers[:site]
      return '' unless site

      if path.nil? || path.to_s.empty?
        version_for(site)
      else
        clean = path.to_s.sub(%r{\?.*$}, '')
        return '' unless clean.start_with?('/')

        file = File.join(site.source, clean)
        return version_for(site) unless File.file?(file)

        digest_for([file])
      end
    end
    private

    # The global version covers every css/js asset plus the theme data that
    # feeds rendered assets (skin font preloads, theme list), so editing the
    # data always produces fresh URLs for assets whose rendered content
    # depends on it (assets/js/theme-bootstrap.js is versioned globally).
    def version_for(site)
      @version_for ||= {}
      @version_for[site.source] ||= begin
        files = Dir.glob(File.join(site.source, 'assets', '{css,js}', '**', '*.{css,js}'))
                   .select { |f| File.file?(f) }
                   .sort
        digest_for(files, site)
      end
    end

    def digest_for(files, site = nil)
      require 'digest'
      require 'json'
      h = Digest::SHA1.new
      files.each do |f|
        h.update(File.basename(f))
        h.update(IO.binread(f))
      end
      if site
        h.update(site.data.fetch('theme_font_preloads', {}).to_json)
        h.update(site.data.fetch('themes', []).to_json)
      end
      h.hexdigest[0, 8]
    end
  end
end

Liquid::Template.register_filter(Jekyll::AssetVersionFilter)
