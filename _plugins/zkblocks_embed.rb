# frozen_string_literal: true

# Embeds the replaceable standalone zkblocks export inside the blog shell.
# Its CSS is scoped at build time; its self-contained scripts are preserved.
class ZkblocksEmbedBuilder
  SOURCE = File.join('_apps', 'zkblocks.html')
  CONTAINER = 'zkblocks-app'

  def self.build(site)
    html = File.read(File.join(site.source, SOURCE), encoding: 'UTF-8')
    head = html[%r{<head\b[^>]*>(.*?)</head>}mi, 1]
    body = html[%r{<body\b[^>]*>(.*?)</body>}mi, 1]
    raise "#{SOURCE} must contain one head and one body" unless head && body

    styles = head.scan(%r{<style\b[^>]*>(.*?)</style>}mi).flatten
    raise "#{SOURCE} must contain at least one inline stylesheet" if styles.empty?
    raise "#{SOURCE} must contain <main>" unless body.match?(%r{<main\b}i)

    # The host owns the document and its sole main landmark. The app keeps its
    # visible wordmark, controls, IDs, inline scripts, WASM payload, and licenses.
    body = body.sub(%r{<main\b([^>]*)>}i, '<div\1 role="application">')
    body = body.sub(%r{</main\s*>}i, '</div>')
    css = styles.map { |style| scope_css(style) }.join("\n")

    <<~HTML
      <div class="#{CONTAINER}" data-zkblocks-app>
        <style>#{css}</style>
        #{body.strip}
      </div>
    HTML
  end

  def self.scope_css(css)
    css = css.gsub(%r{/\*.*?\*/}m, '')
    out = +''
    pos = 0
    while pos < css.length
      open = css.index('{', pos)
      break unless open

      close = find_close(css, open)
      raise "unterminated CSS block in #{SOURCE}" unless close

      head = css[pos...open].strip
      block = css[(open + 1)...close]
      out << transform_rule(head, block)
      pos = close + 1
    end
    out
  end

  def self.find_close(css, open)
    depth = 0
    quote = nil
    escaped = false
    (open...css.length).each do |index|
      char = css[index]
      if quote
        if escaped
          escaped = false
        elsif char == '\\'
          escaped = true
        elsif char == quote
          quote = nil
        end
        next
      end
      if char == '"' || char == "'"
        quote = char
      elsif char == '{'
        depth += 1
      elsif char == '}'
        depth -= 1
        return index if depth.zero?
      end
    end
    nil
  end

  def self.transform_rule(head, block)
    return head + '{' + block + '}' if head.start_with?('@keyframes', '@font-face', '@import', '@charset')

    inner = block.include?('{') ? scope_css(block) : block
    return head + '{' + inner + '}' if head.start_with?('@media', '@supports', '@container', '@layer')

    scoped = head.split(',').filter_map do |selector|
      selector = selector.strip
      next if selector.empty?

      selector = selector.gsub(/:root\b/, ".#{CONTAINER}")
                         .gsub(/\bhtml\b/, ".#{CONTAINER}")
                         .gsub(/\bbody\b/, ".#{CONTAINER}")
      selector = selector.gsub(".#{CONTAINER} .#{CONTAINER}", ".#{CONTAINER}")
      selector.start_with?(".#{CONTAINER}") ? selector : ".#{CONTAINER} #{selector}"
    end.join(', ')
    scoped + '{' + inner + '}'
  end
end

module Jekyll
  class ZkblocksEmbedTag < Liquid::Tag
    def render(context)
      ZkblocksEmbedBuilder.build(context.registers[:site])
    end
  end
end

Liquid::Template.register_tag('zkblocks_embed', Jekyll::ZkblocksEmbedTag)
