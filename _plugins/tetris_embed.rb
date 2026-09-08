# frozen_string_literal: true

# tetris_embed: build-time inline embed of the Tetrasquares app.
#
# Reads the app under tetrasquares/ (never modifies it), extracts the
# game markup, rewrites relative URLs to absolute /tetrasquares/ paths, scopes
# the app stylesheets under a single container class so their global rules
# (body, button, input, [hidden], :root) cannot leak into the host page, and
# exposes everything through the {% tetris_embed %} Liquid tag.
#
# The app JavaScript is untouched and loaded as an ES module from its real
# location, so its relative imports keep resolving.

require 'cgi'

class TetrisEmbedBuilder
  APP_DIR = 'tetrasquares'
  CONTAINER = 'nt-embed'
  LAYOUTS = %w[styles.css src/layouts/pop-schematic.css].freeze

  def self.build(site)
    source = File.join(site.source, APP_DIR)
    html = File.read(File.join(source, 'index.html'), encoding: 'UTF-8')

    body = html[%r{<body[^>]*>(.*?)</body>}m, 1].to_s
    # drop the app's own scripts; the host page loads main.js itself
    body = body.gsub(%r{<script[^>]*>.*?</script>}m, '')
    # the host page already provides main#content and the post h1
    body = body.sub(%r{<main[^>]*>}, '<div class="nt-app-main">').sub(%r{</main>}, '</div>')
    body = body.sub(%r{<h1 class="wordmark"}, '<div class="wordmark"').sub(%r{</h1>}, '</div>')
    # game labels are not document headings; keep them as styled paragraphs
    body = body.gsub(%r{<h([2-6])([^>]*)>}) { '<p class="nt-label nt-h' + Regexp.last_match(1) + '"' + Regexp.last_match(2) + '>' }
    body = body.gsub(%r{</h[2-6]>}, '</p>')
    # relative URLs become absolute to the app
    body = body.gsub(/(href|src)="(?!https?:|\/|#|mailto:)([^"]+)"/) do
      "#{Regexp.last_match(1)}=\"/#{APP_DIR}/#{Regexp.last_match(2)}\""
    end
    # The host supplies analytics; an embedded game must not add a second copy.
    body = body.gsub(/\{%\s*include goatcounter\.html\s*%\}/, '')

    css = LAYOUTS.map do |sheet|
      scope_css(File.read(File.join(source, sheet), encoding: 'UTF-8'))
    end.join("\n")
    # Contained horizontal scrolling on narrow hosts, like the site's code frames.
    css = ".#{CONTAINER}{max-width:100%;overflow-x:auto;}\n" + css

    <<~HTML
      <div class="#{CONTAINER}" data-layout="pop-schematic">
      <style>#{css}</style>
      #{body}
      </div>
      <script type="module" src="/#{APP_DIR}/src/main.js?v=20260911"></script>
    HTML
  end

  # Prefix every rule's selectors with the container class. Global element
  # and root selectors map onto the container itself. @media blocks scope
  # their inner rules; @keyframes and @font-face pass through untouched.
  def self.scope_css(css)
    css = css.gsub(%r{/\*.*?\*/}m, '')
    out = +''
    pos = 0
    while pos < css.length
      open = css.index('{', pos)
      break unless open

      close = find_close(css, open)
      break unless close

      head = css[pos...open].strip
      block = css[(open + 1)...close]
      out << transform_head(head, block)
      pos = close + 1
    end
    out
  end

  def self.find_close(css, open)
    depth = 0
    idx = open
    while idx < css.length
      case css[idx]
      when '{' then depth += 1
      when '}' then depth -= 1
      end
      return idx if depth.zero? && idx > open

      idx += 1
    end
    nil
  end

  def self.transform_head(head, block)
    if head.start_with?('@keyframes', '@font-face', '@import', '@charset')
      return head + '{' + block + '}'
    end

    inner = block.include?('{') ? scope_css(block) : block
    if head.start_with?('@media', '@supports')
      return head + '{' + inner + '}'
    end

    scoped = head.split(',').map do |sel|
      sel = sel.strip
      next '' if sel.empty?

      sel = sel.gsub(/\bhtml\[data-layout[^\]]*\]/, ".#{CONTAINER}")
               .gsub(/\bbody\[data-run[^\]]*\]/, ".#{CONTAINER}")
               .gsub(/\bh1\.wordmark\b/, '.wordmark')
               .gsub(/\bh([2-6])\b/, '.nt-h\1')
               .gsub(/\.nt-h([2-6])\s*\.nt-h([2-6])/, '.nt-h\2')
               .gsub(/\b:root\b/, ".#{CONTAINER}")
               .gsub(/\bhtml\b/, ".#{CONTAINER}")
               .gsub(/\bbody\b/, ".#{CONTAINER}")
      sel = sel.gsub(".#{CONTAINER} .#{CONTAINER}", ".#{CONTAINER}")
      if sel.start_with?(".#{CONTAINER}")
        sel
      else
        ".#{CONTAINER} #{sel}"
      end
    end.reject(&:empty?).join(', ')
    scoped + '{' + inner + '}'
  end
end

module Jekyll
  class TetrisEmbedTag < Liquid::Tag
    def render(context)
      site = context.registers[:site]
      TetrisEmbedBuilder.build(site)
    end
  end
end

Liquid::Template.register_tag('tetris_embed', Jekyll::TetrisEmbedTag)
