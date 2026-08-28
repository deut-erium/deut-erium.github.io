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

class DeuteriumTagAliases < Jekyll::Generator
  safe true
  priority :highest

  def generate(site)
    aliases = site.data.fetch("tag_aliases", {})
    site.posts.docs.each do |post|
      tags = Array(post.data["tags"])
      canonical = tags.map { |tag| aliases.fetch(tag.to_s, tag) }
      post.data["tags"] = canonical.uniq
    end
    site.instance_variable_get(:@post_attr_hash).delete("tags")
  end
end

Jekyll::Hooks.register :posts, :post_init do |post|
  DeuteriumSite::SectionMetadata.apply(post)
end

Jekyll::Hooks.register :pages, :post_init do |page|
  relative = page.path.to_s.delete_prefix("/")
  case relative
  when "404.md"
    page.data["title"] ||= "Page not found"
    page.data["description"] ||= "The requested page does not exist."
    page.data["layout"] = "404"
    page.data["noindex"] = true
    page.data["sitemap"] = false
  when "about.md"
    page.data["title"] ||= "About"
    page.data["layout"] = "page"
  when "archive.html"
    page.data["title"] ||= "Archive"
    page.data["description"] ||= "Browse all posts from the root blog, CTF Writeups, CTF tutorials, and Ramblings."
  when "WriteUps/404.md", "ramblings/404.md", "ctf-tutorials/404.md"
    section_path = relative.split("/", 2).first
    section = DeuteriumSite::SectionMetadata::SECTIONS.fetch(section_path).fetch("section")
    page.data["title"] ||= "Page not found"
    page.data["description"] ||= "The requested page does not exist."
    page.data["layout"] = "404"
    page.data["permalink"] = "/#{section_path}/404.html"
    page.data["section"] = section
    page.data["noindex"] = true
    page.data["sitemap"] = false
  when "ramblings/about.md"
    page.data["title"] = "About"
    page.data["layout"] = "page"
    page.data["section"] = "ramblings"
  when "WriteUps/about.md"
    page.data["layout"] = "page"
    page.data["section"] = "writeups"
  when %r{\AWriteUps/}
    page.data["section"] = "writeups"
  when %r{\Actf-tutorials/}
    page.data["section"] = "tutorials"
  end
end
