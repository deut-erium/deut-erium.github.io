# frozen_string_literal: true

require "digest"
require "json"
require "set"

module DeuteriumSite
  module MarkovTitles
    LIMIT = 32
    MAX_ATTEMPTS = 4096
    MAX_WORDS = 16
    MAX_CHARS = 160
    PRIVATE_FLAGS = %w[hidden unlisted noindex redirect redirect_to locked].freeze

    module_function

    # Kept self-contained for standalone use. In Jekyll, all plugins are loaded
    # before generators run, even though publications.rb sorts after this file.
    def fallback_eligible?(post)
      data = post.data
      %w[article writeup].include?(data["layout"]) && data["sitemap"] != false &&
        data["published"] != false && PRIVATE_FLAGS.none? { |key| data[key] && data[key] != false }
    end

    def eligible?(post)
      if defined?(DeuteriumSite::Publications) && DeuteriumSite::Publications.respond_to?(:eligible?)
        DeuteriumSite::Publications.eligible?(post)
      else
        fallback_eligible?(post)
      end
    end

    def normalize(title)
      title.unicode_normalize(:nfkc).downcase(:fold).scan(/[\p{L}\p{M}\p{N}]+/).join(" ")
    end

    # Also compare whitespace-delimited word sequences with punctuation removed:
    # "can't" and "cant" must not turn into supposedly different article titles.
    def word_sequence(title)
      title.unicode_normalize(:nfkc).downcase(:fold).split(/[[:space:]]+/).map do |word|
        word.gsub(/[^\p{L}\p{M}\p{N}]/, "")
      end.reject(&:empty?).join(" ")
    end

    def source_titles(posts)
      posts.filter_map do |post|
        next unless eligible?(post)

        title = post.data["title"]
        next unless title.is_a?(String) && title.valid_encoding?

        title = title.gsub(/[[:space:]]+/, " ").strip
        title unless normalize(title).empty?
      end.sort.uniq
    end

    # First-order word transitions, with start/end states and source provenance.
    # A path must use edges that no single source title could supply. This rules
    # out single-title loops as well as punctuation/case-only "inventions".
    def generate(posts)
      titles = source_titles(posts)
      originals = titles.map { |title| normalize(title) }.to_set
      sequences = titles.map { |title| word_sequence(title) }.to_set
      titles = titles.uniq { |title| normalize(title) }.uniq { |title| word_sequence(title) }
      return [] if titles.length < 2

      random = Random.new(Digest::SHA256.hexdigest(JSON.generate(titles)).to_i(16))
      transitions = Hash.new { |hash, key| hash[key] = [] }
      owners = Hash.new { |hash, key| hash[key] = Set.new }
      titles.each_with_index do |title, id|
        words = title.split.filter_map do |word|
          key = normalize(word)
          [key, word] unless key.empty?
        end
        ([[:start, nil]] + words + [[:end, nil]]).each_cons(2) do |(from, _), (to, word)|
          transitions[from] << [to, word]
          owners[[from, to]] << id
        end
      end

      results = []
      seen = originals.dup
      all_sources = (0...titles.length).to_set
      MAX_ATTEMPTS.times do
        state = :start
        common_sources = all_sources
        words = []
        # One extra step allows a MAX_WORDS title to reach its end marker.
        (MAX_WORDS + 1).times do
          to, word = transitions.fetch(state).sample(random: random)
          common_sources = common_sources & owners.fetch([state, to])
          state = to
          break if state == :end

          words << word
          break if words.join(" ").length > MAX_CHARS
        end
        next unless state == :end && common_sources.empty? && words.length.between?(2, MAX_WORDS)

        title = words.join(" ")
        next if title.length > MAX_CHARS
        key, sequence = normalize(title), word_sequence(title)
        next if seen.include?(key) || sequences.include?(sequence)

        seen << key
        sequences << sequence
        results << title
        break if results.length == LIMIT
      end
      results
    end

    # JSON inside an HTML script is raw text, not HTML-entity-decoded text.
    # Escaping '<' also prevents closing tags and HTML comment parsing states.
    def embedded_json(titles)
      JSON.generate(titles).gsub(/[<>&'\u2028\u2029]/) { |char| format('\\u%04x', char.ord) }
    end

    if defined?(Jekyll::Generator)
      class Generator < Jekyll::Generator
        safe true
        priority :lowest

        def generate(site)
          titles = MarkovTitles.generate(site.posts.docs)
          # Only this bounded list is exposed to layouts; no corpus or bodies.
          site.data["markov_404"] = { "titles" => titles, "json" => MarkovTitles.embedded_json(titles) }
        end
      end
    end
  end
end
