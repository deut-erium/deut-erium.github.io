# frozen_string_literal: true

require "base64"
require "cgi"
require "date"
require "strscan"

# Validate before writing the site. Metadata is local to each page; this plugin
# generates no index, successor URL or key material. A chain may branch: position
# is predecessor depth (1-based), length is the longest depth under its root.
module DeuteriumSite
  module EncryptionChains
    NEEDS = /\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z/
    SALT = /\A[0-9a-fA-F]{32}\z/
    FIELDS = %w[post needs salt key_answer previous version iterations].freeze
    module_function

    def fail!(message)
      raise "encryption chain: #{message}"
    end

    def route!(route)
      unless route.is_a?(String) && route.length <= 2048 &&
             route.match?(%r{\A/(?:[A-Za-z0-9][A-Za-z0-9_.-]*/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.html\z})
        fail!("route must be a safe site-relative dated .html path")
      end
      dated = %r{/([0-9]{4})/([0-9]{2})/([0-9]{2})/[^/]+\.html\z}.match(route) ||
              %r{/([0-9]{4})-([0-9]{2})-([0-9]{2})-[^/]+\.html\z}.match(route)
      fail!("route needs a date") unless dated
      fail!("route date is invalid") unless dated[1].to_i.positive?
      Date.new(*dated.captures.map(&:to_i))
    rescue Date::Error
      fail!("route date is invalid")
    end

    def needs!(needs)
      unless needs.nil? || (needs.is_a?(String) && (needs.empty? || needs.match?(NEEDS)))
        fail!("needs must be an ID of 1-128 ASCII letters, digits, underscores or hyphens, or empty")
      end
      needs || ""
    end

    def parameters!(version, iterations)
      unless version.is_a?(Integer) && iterations.is_a?(Integer) &&
             [[1, 120_000], [2, 200_000]].include?([version, iterations])
        fail!("unsupported version/iterations")
      end
    end

    def entries(site)
      (site.pages + site.collections.values.flat_map(&:docs)).uniq.select(&:write?)
    end

    def records!(site)
      rows = site.data.fetch("arg_chain", [])
      fail!("arg_chain must be an array") unless rows.is_a?(Array)
      records = {}
      rows.each do |row|
        fail!("record must contain only chain fields") unless row.is_a?(Hash) && (row.keys - FIELDS).empty?
        route = row["post"]
        route!(route)
        fail!("duplicate route: #{route}") if records.key?(route)
        needs!(row["needs"])
        fail!("salt must be a 32-character hex string") unless row["salt"].is_a?(String) && row["salt"].match?(SALT)
        version = row.fetch("version", 1)
        parameters!(version, row.fetch("iterations", version == 1 ? 120_000 : nil))
        if row.key?("key_answer") && !row["key_answer"].is_a?(String)
          fail!("key_answer must be a string")
        end
        route!(row["previous"]) unless row["previous"].nil?
        records[route] = row
      end
      records
    end

    def prepare(site)
      records = records!(site)
      outputs = entries(site)
      locked = outputs.select { |item| item.data["layout"] == "locked" }
      routes = outputs.group_by(&:url)
      destinations = (outputs + site.static_files).group_by { |item| File.expand_path(item.destination(site.dest)) }
      records.each_key do |route|
        docs = routes.fetch(route, [])
        unless docs.length == 1 && locked.include?(docs.first)
          fail!("record must name exactly one rendered locked output: #{route}")
        end
        if destinations.fetch(File.expand_path(docs.first.destination(site.dest))).length != 1
          fail!("locked output collision: #{route}")
        end
      end
      locked.each do |item|
        fail!("locked output has no chain record: #{item.url}") unless records.key?(item.url)
      end
      records.each_value do |row|
        previous = row["previous"]
        fail!("missing predecessor: #{previous}") if previous && !records.key?(previous)
      end
      # Iterative traversal avoids Ruby stack exhaustion on a long valid chain.
      positions = {}
      records.each_key do |route|
        trail, active, current = [], {}, route
        while current && !positions.key?(current)
          fail!("cycle at #{current}") if active[current]
          trail << current
          active[current] = true
          current = records.fetch(current)["previous"]
        end
        depth, root = current ? positions.fetch(current) : [0, trail.last]
        trail.reverse_each do |node|
          depth += 1
          positions[node] = [depth, root]
        end
      end
      lengths = positions.values.group_by(&:last).transform_values { |values| values.map(&:first).max }
      # Do not mutate page data until every graph/schema check has succeeded.
      locked.each do |item|
        depth, root = positions.fetch(item.url)
        item.data["chain_position"] = depth
        item.data["chain_length"] = lengths.fetch(root)
      end
    end

    def attributes(token)
      scanner = StringScanner.new(token)
      return unless scanner.scan(/<([A-Za-z][A-Za-z0-9:-]*)/)
      tag = scanner[1].downcase
      attrs, duplicate = {}, false
      until scanner.eos?
        scanner.skip(/\s+/)
        break if scanner.scan(%r{/?>\z})
        return unless scanner.scan(/([^\s=<>\/'"]+)/)
        name = scanner[1].downcase
        scanner.skip(/\s+/)
        value = ""
        if scanner.scan(/=/)
          scanner.skip(/\s+/)
          return unless scanner.scan(/"([^"]*)"|'([^']*)'|([^\s<>`=]+)/)
          value = scanner[1] || scanner[2] || scanner[3]
        end
        duplicate ||= attrs.key?(name)
        attrs[name] = CGI.unescapeHTML(value)
      end
      [tag, attrs, duplicate]
    end

    def envelope!(html)
      locks = []
      # Scan tags, not apparent markup inside comments or raw-text elements.
      # The payload itself has a deliberately narrow grammar below.
      raw = nil
      template_depth = 0
      html.to_enum(:scan, /<!--.*?-->|<!(?:[^>]*>)|<(?:[^>"']|"[^"]*"|'[^']*')*>/m).each do
        match = Regexp.last_match
        token = match[0]
        next if token.start_with?("<!")
        if raw
          raw = nil if token.match?(%r{\A</#{raw}\s*>}i)
          next
        end
        if token.match?(%r{\A</template\s*>}i)
          template_depth -= 1 if template_depth.positive?
          next
        end
        parsed = attributes(token)
        next unless parsed
        tag, attrs, duplicate = parsed
        template_depth += 1 if tag == "template"
        raw = tag if %w[script style textarea title xmp iframe noembed noframes plaintext].include?(tag)
        next if template_depth.positive?
        next unless attrs.fetch("class", "").split.include?("argon")
        fail!("argon must be a div with unique attributes") unless tag == "div" && !duplicate
        closing = %r{</div\s*>}i.match(html, match.end(0))
        fail!("unclosed argon payload") unless closing
        locks << [attrs, html[match.end(0)...closing.begin(0)]]
      end
      fail!("locked output must contain exactly one argon payload") unless locks.length == 1
      attrs, body = locks.first
      salt = attrs["data-salt"]
      fail!("payload salt must be 32 hex characters") unless salt && salt.match?(SALT)
      needs = needs!(attrs["data-needs"])
      legacy = !attrs.key?("data-version") && !attrs.key?("data-iterations")
      unless legacy || (attrs["data-version"] == "2" && attrs["data-iterations"] == "200000")
        fail!("invalid payload version/iterations")
      end
      version_text = attrs.fetch("data-version", "1")
      iterations_text = attrs.fetch("data-iterations", version_text == "1" ? "120000" : "")
      unless %w[1 2].include?(version_text) && %w[120000 200000].include?(iterations_text)
        fail!("invalid payload version/iterations")
      end
      version, iterations = version_text.to_i, iterations_text.to_i
      parameters!(version, iterations)
      body = body.strip
      # Kramdown serializes the producer's boolean hidden attribute as hidden="".
      if (hidden = /\A<span hidden(?:=""|='')?>([^<]*)<\/span>\z/m.match(body))
        body = hidden[1].strip
      end
      # Historic payloads wrap base64 across lines; new envelopes are canonical.
      body = body.gsub(/[ \t\r\n\f]/, "") if version == 1
      begin
        decoded = Base64.strict_decode64(body)
      rescue ArgumentError
        fail!("malformed base64 payload")
      end
      unless decoded.bytesize.between?(28, 24 * 1024 * 1024) && Base64.strict_encode64(decoded) == body
        fail!("payload needs canonical base64 of nonce12 || ciphertext || tag16")
      end
      [salt.downcase, needs, version, iterations]
    end

    def validate_rendered(site)
      # Recheck the output set in case a render hook changed a route or layout.
      prepare(site)
      records = records!(site)
      entries(site).select { |item| item.data["layout"] == "locked" }.each do |item|
        row = records.fetch(item.url)
        version = row.fetch("version", 1)
        expected = [row["salt"].downcase, needs!(row["needs"]), version,
                    row.fetch("iterations", 120_000)]
        unless envelope!(item.output.to_s) == expected
          fail!("salt/needs/version/iterations differ from payload: #{item.url}")
        end
      end
    end
  end
end

Jekyll::Hooks.register :site, :pre_render do |site|
  DeuteriumSite::EncryptionChains.prepare(site)
end

Jekyll::Hooks.register :site, :post_render do |site|
  DeuteriumSite::EncryptionChains.validate_rendered(site)
end
