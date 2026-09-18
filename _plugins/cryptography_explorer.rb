# frozen_string_literal: true

# Builds the themed cryptography explorer from a replaceable standalone HTML
# export. The export remains a complete page so it can also be opened by itself;
# only its body content is embedded into the blog chrome at build time.
class CryptographyExplorerBuilder
  SOURCE = File.join('_explorations', 'cryptography.html')

  def self.build(site)
    path = File.join(site.source, SOURCE)
    html = File.read(path, encoding: 'UTF-8')
    body = html[%r{<body\b[^>]*>(.*?)</body>}mi, 1]
    raise "#{SOURCE} must contain one HTML body" unless body
    raise "#{SOURCE} must contain <main id=\"outline\">" unless body.match?(%r{<main\b[^>]*\bid=["']outline["']}i)

    # The blog layout owns the visible title and styles. Runtime behavior lives
    # in a stable external asset, so replacing the export cannot duplicate or
    # override site scripts.
    body = body.gsub(%r{<script\b[^>]*>.*?</script\s*>}mi, '')
    body = body.sub(%r{\A\s*<h1\b[^>]*>.*?</h1\s*>}mi, '')
    body = body.sub(%r{<main\b([^>]*\bid=["']outline["'][^>]*)>}i, '<div\1>')
    body = body.sub(%r{</main\s*>}i, '</div>')

    <<~HTML
      <div class="crypto-explorer" data-cryptography-explorer>
        #{body.strip}
      </div>
    HTML
  end
end

module Jekyll
  class CryptographyExplorerTag < Liquid::Tag
    def render(context)
      CryptographyExplorerBuilder.build(context.registers[:site])
    end
  end
end

Liquid::Template.register_tag('cryptography_explorer', Jekyll::CryptographyExplorerTag)
