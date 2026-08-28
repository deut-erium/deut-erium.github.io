# frozen_string_literal: true

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

    module_function

    def apply(document)
      return unless document.output_ext == ".html"

      COMMON_LINKS.each do |old, replacement|
        document.output = document.output.gsub(%(href="#{old}"), %(href="#{replacement}"))
      end
      if File.basename(document.path.to_s) == "2021-04-08-contributions.md" ||
          File.basename(document.path.to_s) == "2021-04-04-contributions.md"
        CONTRIBUTION_LINKS.each do |old, replacement|
          document.output = document.output.gsub(%(href="#{old}"), %(href="#{replacement}"))
        end
      end
      return unless document.path.to_s.end_with?("about.md") && document.url == "/about.html"

      document.output = document.output.sub(
        '<img class="image image--lg" src="Circle-limit-IV.jpg" />',
        '<img class="image image--lg" src="Circle-limit-IV.jpg" alt="Circle Limit IV illustration" width="600" height="602" loading="lazy" />'
      )
    end
  end
end

Jekyll::Hooks.register :documents, :post_render do |document|
  DeuteriumSite::RenderCompatibility.apply(document)
end

Jekyll::Hooks.register :pages, :post_render do |page|
  DeuteriumSite::RenderCompatibility.apply(page)
end
