# frozen_string_literal: true

require "cgi"
require "digest"

module Jekyll
  module CodeFrames
    ROUGE_BLOCK = %r{
      <div\b(?<outer_attributes>[^>]*)>\s*
      <div\b(?<inner_attributes>[^>]*)>\s*
      <pre\b(?<pre_attributes>[^>]*)>\s*
      <code\b[^>]*>(?<code>.*?)</code>\s*
      </pre>\s*</div>\s*</div>
    }mix.freeze
    ATTRIBUTE = %r{
      (?:\A|\s)(?<name>[^\s=/>]+)\s*=\s*
      (?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))
    }mx.freeze
    LANGUAGE_CLASS = /\Alanguage-(?<language>[A-Za-z0-9_+.-]+)\z/.freeze

    LABELS = {
      "bash" => "Bash",
      "c" => "C",
      "go" => "Go",
      "javascript" => "JavaScript",
      "plaintext" => "Plain text",
      "python" => "Python",
      "text" => "Plain text"
    }.freeze

    module_function

    def class_tokens(attributes)
      values = []
      offset = 0
      while (match = ATTRIBUTE.match(attributes, offset))
        if match[:name].casecmp?("class")
          values << (match[:double] || match[:single] || match[:bare] || "")
        end
        offset = match.end(0)
      end
      return nil unless values.length <= 1

      values.empty? ? [] : CGI.unescapeHTML(values.first).split
    end

    def source_text(highlighted_html)
      CGI.unescapeHTML(highlighted_html.gsub(%r{<[^>]+>}, ""))
    end

    def source_lines(source)
      lines = source.split("\n", -1)
      lines.pop if source.end_with?("\n")
      lines.empty? ? [""] : lines
    end

    def likely_overflow?(lines)
      lines.any? { |line| line.gsub("\t", "    ").length > 16 }
    end

    def render(output)
      index = 0
      output.gsub(ROUGE_BLOCK) do
        match = Regexp.last_match
        original = match[0]
        classes = class_tokens(match[:outer_attributes])
        inner_classes = class_tokens(match[:inner_attributes])
        pre_classes = class_tokens(match[:pre_attributes])
        language_matches = classes&.filter_map { |token| LANGUAGE_CLASS.match(token) }
        next original unless classes&.include?("highlighter-rouge") &&
          inner_classes&.include?("highlight") && pre_classes&.include?("highlight") &&
          language_matches&.one?

        index += 1
        language = language_matches.first[:language]
        highlighted = match[:code]
        source = source_text(highlighted)
        lines = source_lines(source)
        label = LABELS.fetch(language, language.tr("_-", " ").split.map(&:capitalize).join(" "))
        status_id = "code-frame-status-#{index}"
        label_id = "code-frame-label-#{index}"
        overflow_attributes = if likely_overflow?(lines)
          %( tabindex="0" aria-label="#{CGI.escapeHTML(label)} code; horizontally scrollable")
        else
          ""
        end
        line_word = lines.length == 1 ? "line" : "lines"
        gutter = (1..lines.length).to_a.join("\n")

        <<~HTML.chomp
          <figure class="code-frame #{CGI.escapeHTML(classes.join(" "))}" data-code-frame data-language="#{CGI.escapeHTML(language)}" data-lines="#{lines.length}" data-source-sha256="#{Digest::SHA256.hexdigest(source)}" aria-labelledby="#{label_id}">
            <figcaption class="code-frame__bar">
              <span class="code-frame__label" id="#{label_id}"><strong>#{CGI.escapeHTML(label)}</strong><small>#{lines.length} #{line_word} / static highlight</small></span>
              <span class="code-frame__actions">
                <button type="button" data-wrap-code aria-label="Wrap #{CGI.escapeHTML(label)} code frame #{index}" aria-pressed="false" disabled hidden>Wrap</button>
                <button type="button" data-copy-code aria-label="Copy #{CGI.escapeHTML(label)} code frame #{index}" aria-describedby="#{status_id}" disabled hidden>Copy</button>
              </span>
            </figcaption>
            <div class="code-frame__viewport">
              <div class="code-frame__gutter" aria-hidden="true">#{gutter}</div>
              <div class="highlight"><pre class="highlight"#{overflow_attributes}><code>#{highlighted}</code></pre></div>
            </div>
            <p class="code-frame__status" id="#{status_id}" role="status" aria-live="polite" aria-atomic="true"></p>
          </figure>
        HTML
      end
    end
  end
end

Jekyll::Hooks.register :documents, :post_render do |document|
  next unless document.output_ext == ".html"

  document.output = Jekyll::CodeFrames.render(document.output)
end

Jekyll::Hooks.register :pages, :post_render do |page|
  next unless page.output_ext == ".html"

  page.output = Jekyll::CodeFrames.render(page.output)
end
