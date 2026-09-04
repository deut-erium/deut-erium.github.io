# frozen_string_literal: true

# Build-time QR share codes (roadmap 12b).
#
# One self-contained /qr/<slug>.svg per post is generated at build time with
# the rqrcode gem (MIT) and written next to the rendered site. Article
# layouts embed the same matrix inline through the Liquid tags registered
# here, so the popover needs no runtime JavaScript to show a scannable code:
# the details element, the SVG and the canonical URL text all work with
# scripts disabled. Only the copy/share button is a progressive enhancement
# (see _includes/qr-share.html).
#
# The canonical origin matches the one hard-coded in script/verify-site.py,
# so the QR payload always equals the page canonical URL byte for byte.

require "cgi"
require "liquid"
require "rqrcode"

module Deuterium
  module QRShare
    DEFAULT_ORIGIN = "https://deut-erium.github.io"
    ROUTE_PREFIX   = "/qr/"
    ROUTE_DIR      = "qr"
    QUIET_ZONE     = 4
    MODULE_FILL    = "#0f1015"
    PAPER_FILL     = "#ffffff"

    class << self
      def origin(site)
        configured = site&.config&.fetch("url", nil).to_s.sub(%r{/+\z}, "")
        configured.empty? ? DEFAULT_ORIGIN : configured
      end

      def canonical_url(site, page_url)
        page_url = page_url.to_s
        return nil if page_url.empty?

        "#{origin(site)}#{page_url}"
      end

      # Filesystem-safe asset name derived from the route. Underscores, dots,
      # dashes and word characters survive; every other run of characters
      # (slashes included) collapses to a single dash.
      def asset_slug(page_url)
        slug = CGI.unescape(page_url.to_s.sub(%r{\A/+}, "").sub(/\.html?\z/i, ""))
        slug = slug.gsub(%r{[^0-9A-Za-z._~-]+}, "-").gsub(%r{\A-+|-+\z}, "")
        slug.empty? ? "index" : slug
      end

      def asset_href(page_url)
        "#{ROUTE_PREFIX}#{asset_slug(page_url)}.svg"
      end

      def svg_inline(site, page_url)
        url = canonical_url(site, page_url)
        return "" if url.nil?

        svg(url, inline: true)
      end

      def svg_document(url)
        svg(url, inline: false)
      end

      def escape_html(value)
        value.gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;").gsub('"', "&quot;")
      end

      private

      def svg(url, inline:)
        core = RQRCode::QRCode.new(url, level: :l).qrcode
        count = core.module_count
        total = count + QUIET_ZONE * 2
        pixel = total * 4
        label = escape_html("QR code linking to #{url}")
        attrs = if inline
                  'class="qr-share__code"'
                else
                  "width=\"#{pixel}\" height=\"#{pixel}\""
                end
        "<svg xmlns=\"http://www.w3.org/2000/svg\" #{attrs} role=\"img\" aria-label=\"#{label}\"" \
          " viewBox=\"0 0 #{total} #{total}\" shape-rendering=\"crispEdges\">" \
          "<rect width=\"#{total}\" height=\"#{total}\" fill=\"#{PAPER_FILL}\"/>" \
          "<path fill=\"#{MODULE_FILL}\" d=\"#{module_path(core, count)}\"/></svg>"
      end

      # One subpath per horizontal run of dark modules. Relative h/v commands
      # keep each run around sixteen bytes, which keeps inline copies small.
      def module_path(core, count)
        runs = []
        y = 0
        while y < count
          row = core.modules[y]
          x = 0
          while x < count
            if row[x]
              start = x
              x += 1 while x < count && row[x]
              length = x - start
              runs << "M#{start + QUIET_ZONE} #{y + QUIET_ZONE}h#{length}v1h-#{length}z"
            else
              x += 1
            end
          end
          y += 1
        end
        runs.join
      end
    end
  end
end

# Liquid tags used by _includes/qr-share.html and the article layouts. They
# resolve the current page through the render registers so the inline code
# and the generated asset can never drift apart.
module Deuterium
  module QRShare
    class PageUrlTag < Liquid::Tag
      def render(context)
        page = context.registers[:page] || {}
        url = Deuterium::QRShare.canonical_url(context.registers[:site], page["url"])
        url.nil? ? "" : Deuterium::QRShare.escape_html(url)
      end
    end

    class AssetHrefTag < Liquid::Tag
      def render(context)
        page = context.registers[:page] || {}
        return "" if page["url"].to_s.empty?

        Deuterium::QRShare.asset_href(page["url"])
      end
    end

    class InlineSvgTag < Liquid::Tag
      def render(context)
        page = context.registers[:page] || {}
        Deuterium::QRShare.svg_inline(context.registers[:site], page["url"])
      end
    end
  end
end

Liquid::Template.register_tag("qr_url",  Deuterium::QRShare::PageUrlTag)
Liquid::Template.register_tag("qr_href", Deuterium::QRShare::AssetHrefTag)
Liquid::Template.register_tag("qr_svg",  Deuterium::QRShare::InlineSvgTag)

# Generated asset: rendered straight to the destination, never read from a
# source file. The content is a pure function of the canonical URL, so
# builds are deterministic.
module Deuterium
  module QRShare
    class GeneratedSvgFile < Jekyll::StaticFile
      def initialize(site, name, canonical_url)
        super(site, site.source, Deuterium::QRShare::ROUTE_DIR, name)
        @canonical_url = canonical_url
      end

      def write(dest)
        target = destination(dest)
        ::FileUtils.mkdir_p(::File.dirname(target))
        ::File.binwrite(target, Deuterium::QRShare.svg_document(@canonical_url))
        true
      end
    end
  end
end

module Deuterium
  module QRShare
    class Generator < Jekyll::Generator
      priority :low

      def generate(site)
        used = {}
        site.posts.docs.each do |doc|
          url = doc.url.to_s
          next if url.empty?

          slug = Deuterium::QRShare.asset_slug(url)
          if used.key?(slug)
            used[slug] += 1
            slug = "#{slug}-#{used[slug]}"
          else
            used[slug] = 1
          end
          site.static_files << GeneratedSvgFile.new(
            site, "#{slug}.svg", Deuterium::QRShare.canonical_url(site, url)
          )
        end
      end
    end
  end
end
