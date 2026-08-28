# frozen_string_literal: true

module DeuteriumSite
  module SectionMetadata
    SECTIONS = {
      "WriteUps" => { "section" => "writeups", "layout" => "writeup" },
      "ctf-tutorials" => { "section" => "tutorials", "layout" => "article" },
      "ramblings" => { "section" => "ramblings", "layout" => "article" },
    }.freeze

    module_function

    def apply(post)
      relative = post.relative_path.to_s.delete_prefix("/")
      source_path = relative.sub(%r{\A_posts/}, "")
      top_level = source_path.split("/", 2).first
      metadata = SECTIONS.fetch(top_level, { "section" => "root", "layout" => "article" })

      post.data["section"] = metadata.fetch("section")
      post.data["layout"] = metadata.fetch("layout")
      post.data["source_path"] = relative

      if top_level == "WriteUps"
        output_path = source_path.sub(/\.(?:md|markdown)\z/i, ".html")
        post.data["permalink"] = "/#{output_path}"
      elsif top_level == "ramblings" || top_level == "ctf-tutorials"
        filename = File.basename(source_path).sub(/\.(?:md|markdown)\z/i, "")
        match = /\A(?<year>\d{4}|\d{2})-(?<month>\d{2})-(?<day>\d{2})-(?<slug>.+)\z/.match(filename)
        raise "invalid dated post filename: #{relative}" unless match

        year = match[:year].length == 2 ? "20#{match[:year]}" : match[:year]
        date_path = [year, match[:month], match[:day]].join("/")
        slug = match[:slug].gsub(/\s+/, "-")
        post.data["permalink"] = "/#{top_level}/#{date_path}/#{slug}.html"
      end
    end
  end
end

Jekyll::Hooks.register :posts, :post_init do |post|
  DeuteriumSite::SectionMetadata.apply(post)
end

Jekyll::Hooks.register :pages, :post_init do |page|
  relative = page.path.to_s.delete_prefix("/")
  case relative
  when "ramblings/about.md"
    page.data["title"] = "About"
    page.data["layout"] = "page"
    page.data["section"] = "ramblings"
  when %r{\AWriteUps/}
    page.data["section"] = "writeups"
  when %r{\Actf-tutorials/}
    page.data["section"] = "tutorials"
  end
end
