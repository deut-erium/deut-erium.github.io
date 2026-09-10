# frozen_string_literal: true

# Keep selected posts available at their canonical URLs while excluding them
# from discovery surfaces. jekyll-paginate already omits `hidden` posts; the
# site's other indexes apply the same flag explicitly.
module DeuteriumSite
  module HiddenPosts
    class ConfigurationError < StandardError; end

    module_function

    def relative_path(document, site)
      document.relative_path.to_s.delete_prefix("#{site.source}/").delete_prefix("/")
    end

    def apply(site)
      config = site.data.fetch("hidden_posts") do
        raise ConfigurationError, "_data/hidden_posts.json is missing"
      end
      unless config.is_a?(Hash) && config["version"] == 1 && config["posts"].is_a?(Array)
        raise ConfigurationError, "invalid hidden-post configuration"
      end

      documents = site.posts.docs.to_h { |document| [relative_path(document, site), document] }
      paths = []
      urls = []
      config["posts"].each do |entry|
        unless entry.is_a?(Hash)
          raise ConfigurationError, "hidden-post entry must be an object"
        end
        path = entry["path"]
        url = entry["url"]
        reason = entry["reason"]
        unless path.is_a?(String) && path.match?(%r{\A_posts/(?:[^/]+/)*\d{4}-\d{2}-\d{2}-[^/]+\.md\z}) && !path.include?("..")
          raise ConfigurationError, "invalid hidden-post path: #{path.inspect}"
        end
        unless url.is_a?(String) && url.match?(%r{\A/(?:[^/?#]+/)*[^/?#]+\.html\z})
          raise ConfigurationError, "invalid hidden-post URL: #{url.inspect}"
        end
        unless reason.is_a?(String) && !reason.strip.empty?
          raise ConfigurationError, "hidden-post reason is missing: #{path}"
        end
        raise ConfigurationError, "duplicate hidden-post path: #{path}" if paths.include?(path)
        raise ConfigurationError, "duplicate hidden-post URL: #{url}" if urls.include?(url)

        document = documents[path]
        raise ConfigurationError, "hidden post does not exist: #{path}" unless document
        unless document.url == url
          raise ConfigurationError, "hidden-post URL drift for #{path}: #{document.url} != #{url}"
        end
        document.data["hidden"] = true
        document.data["sitemap"] = false
        document.data["noindex"] = true
        paths << path
        urls << url
      end

      stray = site.posts.docs.filter_map do |document|
        path = relative_path(document, site)
        path if document.data["hidden"] == true && !paths.include?(path)
      end
      unless stray.empty?
        raise ConfigurationError, "post uses hidden without registration: #{stray.join(', ')}"
      end
    end
  end
end

class DeuteriumHiddenPostsGenerator < Jekyll::Generator
  safe true
  priority :highest

  def generate(site)
    DeuteriumSite::HiddenPosts.apply(site)
  end
end
