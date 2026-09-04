# frozen_string_literal: true

# Daily cipher (roadmap section 11, "Daily cipher").
#
# One small classical-cipher puzzle per day at /daily/. This generator
# deterministically derives a puzzle for each of the next 365 build days and
# writes them to _data/daily_ciphers.yml, which the page embeds as JSON.
#
# Determinism: every choice for a date (plaintext, key, salt, hint position)
# is derived from SHA-256 over a namespace, a digest of the plaintext pool,
# and the ISO date. No RNG state is involved, so rebuilding with the same
# pool and the same start date reproduces the file exactly, and the puzzle
# for a given date depends on nothing but that date and the pool.
#
# Secrecy contract: plaintext answers never appear in the data file or any
# generated artifact. Each puzzle stores only the ciphertext, one revealed
# letter mapping (the hint), a per-day salt, and sha256(salt + answer), where
# the answer is the plaintext normalized to single spaces and uppercased.
# The page recomputes that digest in the browser to check guesses.
#
# Ciphers: Caesar (shift 1..25) is the v1 cipher. The Vigenere variant is
# implemented and held back behind ACTIVE_CIPHER for a later build; the data
# file records the planned variant so the page can say "not yet" if it is
# ever enabled without a client update.

require "date"
require "digest"

module DeuteriumSite
  module DailyCipher
    SCHEMA_VERSION = 1
    DAY_COUNT = 365
    NAMESPACE = "deuterium:daily-cipher:v1"
    # Puzzle numbers count days from a fixed epoch: #1 is DAY_ONE itself.
    DAY_ONE = Date.new(2026, 1, 1)
    ACTIVE_CIPHER = "caesar"
    PLANNED_CIPHER = "vigenere"
    ANSWER_CHECK = "sha256(salt + answer)"
    # Keywords for the planned Vigenere variant, picked per day by seed.
    VIGENERE_KEYWORDS = %w[deuterium escher cipher lattice flag].freeze

    # Hand-written short plaintexts, always in the pool alongside post titles.
    QUOTES = [
      "never roll your own crypto",
      "the plaintext always leaks",
      "entropy is not a suggestion",
      "rotate your keys not your excuses",
      "shift happens",
      "read the source luke",
      "brute force is a strategy",
      "short keys make long faces",
      "the hash does not lie",
      "one time pads are forever",
      "cleartext is a lifestyle choice",
      "side channels tell the truth",
      "the padding oracle knows",
      "cryptanalysis before breakfast",
      "zeros ones and coffee",
      "penguins can keep secrets",
      "every cipher wants a friend",
      "solve one cipher every day",
      "x marks the flag",
      "gone ciphering",
    ].freeze

    module_function

    def normalize(text)
      text.to_s.gsub(/\s+/, " ").strip
    end

    def letter?(char)
      char.match?(/[a-zA-Z]/)
    end

    def shift_letter(char, shift)
      return char unless letter?(char)

      base = char.match?(/[a-z]/) ? "a".ord : "A".ord
      ((char.ord - base + shift) % 26 + base).chr
    end

    # v1 cipher: every letter slides by the same shift.
    def caesar(text, shift)
      text.each_char.map { |char| shift_letter(char, shift) }.join
    end

    # Planned variant: keyword shift stream over letters only. Not emitted
    # while ACTIVE_CIPHER stays "caesar"; kept here so enabling it later is
    # a constant flip plus a client update, nothing else.
    def vigenere(text, keyword)
      key = keyword.to_s.downcase.each_char.select { |char| char.match?(/[a-z]/) }
      return text if key.empty?

      alphabet = ("a".."z").to_a
      index = 0
      text.each_char.map do |char|
        if letter?(char)
          shift = alphabet.index(key[index % key.length])
          index += 1
          shift_letter(char, shift)
        else
          char
        end
      end.join
    end

    def derive(seed, label)
      Digest::SHA256.hexdigest("#{seed}|#{label}")
    end

    def derive_int(seed, label, limit)
      derive(seed, label).to_i(16) % limit
    end

    def encrypt_answer(seed, answer)
      case ACTIVE_CIPHER
      when "caesar"
        caesar(answer, 1 + derive_int(seed, "shift", 25))
      when "vigenere"
        keyword = VIGENERE_KEYWORDS[derive_int(seed, "keyword", VIGENERE_KEYWORDS.length)]
        vigenere(answer, keyword)
      else
        raise "unsupported daily cipher: #{ACTIVE_CIPHER}"
      end
    end

    def plaintext_pool(site)
      titles = site.posts.docs.map { |doc| normalize(doc.data["title"].to_s) }
      pool = titles + QUOTES.map { |quote| normalize(quote) }
      pool = pool.reject(&:empty?).reject { |entry| entry.match?(/[[:cntrl:]]/) }.uniq
      raise "daily cipher plaintext pool is empty" if pool.empty?

      pool
    end

    def pool_digest(pool)
      Digest::SHA256.hexdigest(pool.sort.join("\u0000"))
    end

    def build_puzzle(date, pool)
      seed = Digest::SHA256.hexdigest([NAMESPACE, pool_digest(pool), date.iso8601].join("|"))
      answer = pool[derive_int(seed, "pick", pool.length)].upcase
      ciphertext = encrypt_answer(seed, answer)
      salt = derive(seed, "salt")[0, 32]
      # The hint reveals one ciphertext-to-plaintext letter pair. It is taken
      # at a seeded letter position, which stays correct for the position-
      # dependent Vigenere variant as well.
      letter_positions = answer.each_char.with_index.select { |char, _index| letter?(char) }.map { |_char, index| index }
      position = letter_positions[derive_int(seed, "hint", letter_positions.length)] || 0
      {
        "date" => date.iso8601,
        "n" => (date - DAY_ONE).to_i + 1,
        "cipher" => ACTIVE_CIPHER,
        "ciphertext" => ciphertext,
        "hint" => { "from" => ciphertext[position], "to" => answer[position] },
        "salt" => salt,
        "answer_sha256" => Digest::SHA256.hexdigest("#{salt}#{answer}"),
      }
    end

    def build_document(site)
      start_date = site.time.to_date
      pool = plaintext_pool(site)
      {
        "version" => SCHEMA_VERSION,
        "cipher" => ACTIVE_CIPHER,
        "variant" => PLANNED_CIPHER,
        "epoch" => DAY_ONE.iso8601,
        "days" => DAY_COUNT,
        "generated_on" => start_date.iso8601,
        "answer_check" => ANSWER_CHECK,
        "puzzles" => (0...DAY_COUNT).map { |offset| build_puzzle(start_date + offset, pool) },
      }
    end

    # Hand-rolled emitter: every string in double quotes so dates stay
    # strings (a plain 2026-09-05 would load back as a Date), no line
    # folding, and no anchors or tags can ever appear.
    def yaml_string(value)
      escaped = value.to_s.gsub("\\") { "\\\\" }.gsub('"') { '\\"' }
      "\"#{escaped}\""
    end

    def puzzle_yaml(puzzle)
      [
        "- date: #{yaml_string(puzzle['date'])}",
        "  n: #{puzzle['n']}",
        "  cipher: #{puzzle['cipher']}",
        "  ciphertext: #{yaml_string(puzzle['ciphertext'])}",
        "  hint:",
        "    from: #{yaml_string(puzzle['hint']['from'])}",
        "    to: #{yaml_string(puzzle['hint']['to'])}",
        "  salt: #{yaml_string(puzzle['salt'])}",
        "  answer_sha256: #{yaml_string(puzzle['answer_sha256'])}",
      ].join("\n")
    end

    def document_yaml(document)
      [
        "# Generated by _plugins/daily_cipher.rb. Do not edit by hand.",
        "#",
        "# One puzzle per day for the #{DAY_COUNT} days from generated_on.",
        "# Same plaintext pool plus same start date rebuilds this file",
        "# exactly; each day's puzzle depends only on that date and the",
        "# pool digest.",
        "#",
        "# Plaintext answers are never stored. Each day carries its",
        "# ciphertext, one revealed letter mapping, and the salt plus",
        "# #{ANSWER_CHECK} digest the browser recomputes for answer checks,",
        "# with the answer normalized to single spaces and uppercased.",
        "#",
        "# Active cipher: #{ACTIVE_CIPHER}. Planned variant: #{PLANNED_CIPHER}.",
        "---",
        "version: #{document['version']}",
        "cipher: #{document['cipher']}",
        "variant: #{document['variant']}",
        "epoch: #{yaml_string(document['epoch'])}",
        "days: #{document['days']}",
        "generated_on: #{yaml_string(document['generated_on'])}",
        "answer_check: #{yaml_string(document['answer_check'])}",
        "puzzles:",
        document["puzzles"].map { |puzzle| puzzle_yaml(puzzle) }.join("\n"),
        "",
      ].join("\n")
    end

    def data_path(site)
      site.in_source_dir("_data", "daily_ciphers.yml")
    end

    def generate(site)
      document = build_document(site)
      File.write(data_path(site), document_yaml(document))
      # The data reader ran before generators, so publish this build's window
      # in memory too; {{ site.data.daily_ciphers }} renders the fresh copy.
      site.data["daily_ciphers"] = document
      Jekyll.logger.info(
        "Daily cipher:",
        "#{DAY_COUNT} puzzles from #{document['generated_on']} written to _data/daily_ciphers.yml"
      )
    end
  end

  class DailyCipherGenerator < Jekyll::Generator
    priority :low

    def generate(site)
      DeuteriumSite::DailyCipher.generate(site)
    end
  end
end
