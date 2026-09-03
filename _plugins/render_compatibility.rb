# frozen_string_literal: true

require "cgi"

module DeuteriumSite
  module RenderCompatibility
    SOURCE_ROOT = "https://github.com/deut-erium/deut-erium.github.io"
    COMMON_LINKS = {
      "www.try2hack.nl/" => "https://www.try2hack.nl/",
      "deut-erium.github.io/404.md" => "#{SOURCE_ROOT}/blob/master/404.md",
    }.freeze
    CONTRIBUTION_LINKS = {
      "../_posts" => "#{SOURCE_ROOT}/tree/master/_posts",
      "../_drafts" => "#{SOURCE_ROOT}/tree/master/_drafts",
      "_data/authors.yml" => "#{SOURCE_ROOT}/blob/master/_data/authors.yml",
      "../_config.yml" => "#{SOURCE_ROOT}/blob/master/_config.yml",
      "assignemts" => "/ctf-tutorials/assignments.html",
    }.freeze
    MEMORY_GIF = "https://media.giphy.com/media/hNGPQK5eGDzTW/giphy.gif"
    PYTHIA_GCM = "https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/GCM-Galois_Counter_Mode_with_IV.svg/1000px-GCM-Galois_Counter_Mode_with_IV.svg.png"
    EMOJI = {
      "smile" => "😄",
      "wink" => "😉",
      "heart" => "❤️",
      "metal" => "🤘",
      "flushed" => "😳",
      "disappointed" => "😞",
      "triumph" => "😤",
      "expressionless" => "😑",
      "sad" => "😢",
      "grin" => "😁",
      "stuck_out_tongue" => "😛",
    }.freeze

    module_function

    def normalize_math(document)
      if document.path.to_s.end_with?("2022-05-21-HTB-Cyber-Apcalypse-2022-Memory-Acceleration.md")
        document.data["mathjax"] = true
      end
      return unless document.data["mathjax"] == true

      fenced = false
      fence_marker = nil
      document.content = document.content.lines.map do |line|
        if (match = line.match(/^\s*(`{3,}|~{3,})/))
          marker = match[1][0]
          if !fenced
            fenced = true
            fence_marker = marker
          elsif marker == fence_marker
            fenced = false
            fence_marker = nil
          end
          next line
        end
        next line if fenced

        parts = line.split(/(`+[^`]*`+)/)
        parts.each_with_index.map do |part, index|
          index.odd? ? part : part.gsub(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/, '$$\1$$')
        end.join
      end.join
    end

    def apply(document)
      return unless document.output_ext == ".html"

      COMMON_LINKS.each do |old, replacement|
        document.output = document.output.gsub(%(href="#{old}"), %(href="#{replacement}"))
      end
      EMOJI.each do |name, character|
        document.output = document.output.gsub(":#{name}:", character)
      end
      if File.basename(document.path.to_s) == "2021-04-08-contributions.md" ||
          File.basename(document.path.to_s) == "2021-04-04-contributions.md"
        CONTRIBUTION_LINKS.each do |old, replacement|
          document.output = document.output.gsub(%(href="#{old}"), %(href="#{replacement}"))
        end
      end

      if document.path.to_s.end_with?("2021-07-21-google-ctf-2021-pythia.md")
        document.output = document.output.gsub(
          /<img\b[^>]*\bsrc\s*=\s*["']#{Regexp.escape(PYTHIA_GCM)}["'][^>]*>/i,
          '<img src="gcm_mode_diagram.png" alt="GCM (Galois/Counter Mode) encryption diagram, from Wikimedia Commons" width="600" height="660" loading="lazy" decoding="async">'
        )
      elsif document.path.to_s.end_with?("2022-05-21-HTB-Cyber-Apcalypse-2022-Memory-Acceleration.md")
        document.output = document.output.gsub(
          /<img\b[^>]*\bsrc\s*=\s*["']#{Regexp.escape(MEMORY_GIF)}["'][^>]*>/i,
          '<p><a href="https://media.giphy.com/media/hNGPQK5eGDzTW/giphy.gif">Two hours later</a> (external animation).</p>'
        )
      elsif document.path.to_s.end_with?("2022-07-04-Google-CTF-22-Maybe-Someday.md")
        document.output = document.output.sub(
          '<a href="https://cryptopals.com/sets/6/challenges/47"></a>',
          '<a href="https://cryptopals.com/sets/6/challenges/47">Cryptopals RSA padding oracle challenge</a>'
        )
      end

      if document.path.to_s.end_with?("about.md") && document.url == "/about.html"
        document.output = document.output.sub('<div class="item">', '<div class="item about-profile">')
        document.output = document.output.sub(
          '<img class="image image--lg" src="Circle-limit-IV.jpg" />',
          '<img class="image image--lg" src="Circle-limit-IV.jpg" alt="M. C. Escher&#39;s Circle Limit IV, used as deuterium&#39;s profile image" width="600" height="602" loading="lazy" decoding="async" />'
        )
      end
      restore_heading_levels(document)
      normalize_heading_outline(document)
      enrich_images(document)
    end

    def restore_heading_levels(document)
      return unless ["root", "tutorials"].include?(document.data["section"])

      document.output = document.output.sub(/(<article\b[^>]*id="article-body"[^>]*>)(.*?)(<\/article>)/m) do
        opening = Regexp.last_match(1)
        closing = Regexp.last_match(3)
        body = Regexp.last_match(2).gsub(%r{<(\/?)h([3-6])(\b[^>]*)>}) do
          level = Regexp.last_match(2).to_i - 1
          "<#{Regexp.last_match(1)}h#{level}#{Regexp.last_match(3)}>"
        end
        "#{opening}#{body}#{closing}"
      end
    end

    def normalize_heading_outline(document)
      document.output = document.output.sub(/(<main\b[^>]*>)(.*)(<\/main>)/m) do
        opening = Regexp.last_match(1)
        closing = Regexp.last_match(3)
        previous = 1
        current = nil
        body = Regexp.last_match(2).gsub(%r{<(\/?)h([1-6])(\b[^>]*)>}) do |tag|
          closing_tag = Regexp.last_match(1) == "/"
          source_level = Regexp.last_match(2).to_i
          if closing_tag
            level = current || source_level
            current = nil
          else
            level = [source_level, previous + 1].min
            previous = level
            current = level
          end
          tag.sub(/h#{source_level}/, "h#{level}")
        end
        "#{opening}#{body}#{closing}"
      end
    end

    def enrich_images(document)
      relative = document.relative_path.to_s.delete_prefix("/").delete_prefix("_posts/").delete_prefix("WriteUps/")
      images = document.site.data.fetch("image_metadata", {}).fetch(relative, [])
      return if images.empty?

      index = 0
      document.output = document.output.gsub(/<img\b[^>]*>/i) do |tag|
        metadata = images[index]
        next tag unless metadata

        index += 1
        expected_src = metadata.fetch("src")
        actual_src = tag[/\bsrc\s*=\s*["']([^"']*)["']/i, 1]
        unless actual_src == expected_src
          raise "image order drift in #{document.relative_path}: #{actual_src.inspect} != #{expected_src.inspect}"
        end

        enriched = tag.dup
        metadata.each do |name, value|
          next if name == "src"

          escaped = CGI.escapeHTML(value.to_s)
          attribute = /\s#{Regexp.escape(name)}\s*=\s*["'][^"']*["']/i
          if enriched.match?(attribute)
            enriched = enriched.sub(attribute, %( #{name}="#{escaped}"))
          else
            enriched = enriched.sub(/\s*\/?>(?=\z)/, %( #{name}="#{escaped}">))
          end
        end
        enriched
      end
      if index != images.length
        raise "image count drift in #{document.relative_path}: #{index} != #{images.length}"
      end
    end
  end
end

Jekyll::Hooks.register :documents, :pre_render do |document|
  DeuteriumSite::RenderCompatibility.normalize_math(document)
end

Jekyll::Hooks.register :documents, :post_render do |document|
  DeuteriumSite::RenderCompatibility.apply(document)
end

Jekyll::Hooks.register :pages, :post_render do |page|
  DeuteriumSite::RenderCompatibility.apply(page)
end
