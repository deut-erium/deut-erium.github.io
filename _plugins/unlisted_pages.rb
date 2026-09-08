# frozen_string_literal: true

# Keep followup encrypted articles reachable without adding them to post lists.
# Run after generators so a contradictory flag or colliding route fails before writing.
module DeuteriumSite
  module UnlistedPages
    module_function

    def relative_path(item, site)
      item.relative_path.to_s.delete_prefix("#{site.source}/").delete_prefix("/")
    end

    def validate(site)
      documents = site.collections.values.flat_map(&:docs)
      entries = site.pages + documents
      hidden = []
      entries.each do |item|
        data = item.data
        relative = relative_path(item, site)
        if (data.key?("unlisted") || !data["unlisted"].nil?) && ![true, false].include?(data["unlisted"])
          raise "unlisted must be a YAML boolean: #{relative}"
        end
        if relative.start_with?("locked/") && data["unlisted"] != true
          raise "pages under locked/ must be unlisted: #{relative}"
        end
        next unless data["unlisted"] == true

        unless item.is_a?(Jekyll::Page) && data["layout"] == "locked"
          raise "unlisted requires a standalone locked page, not a post; use encrypt_post.py --unlisted: #{relative}"
        end
        unless item.content.to_s.match?(/<div\b[^>]*\bclass=["'][^"']*\bargon\b/)
          raise "unlisted locked page has no payload; encrypt its HTML first: #{relative}"
        end
        # Do not allow a page-level override to put an unlisted page in a sitemap.
        data["sitemap"] = false
        data["noindex"] = true
        hidden << item
      end

      # Raw attachments/drafts in this tree would otherwise be copied publicly.
      site.static_files.each do |item|
        if relative_path(item, site).start_with?("locked/")
          raise "locked/ may contain only encrypted pages; embed assets from a private directory instead"
        end
      end

      outputs = (entries + site.static_files).group_by { |item| File.expand_path(item.destination(site.dest)) }
      hidden.each do |item|
        if outputs.fetch(File.expand_path(item.destination(site.dest))).length != 1
          raise "unlisted page output collides with another page or asset: #{item.url}"
        end
      end
    end
  end
end

Jekyll::Hooks.register :site, :pre_render do |site|
  DeuteriumSite::UnlistedPages.validate(site)
end
