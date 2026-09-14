# frozen_string_literal: true

# Challenge engine v2 authoring helper.
#
# Prompts for a flag, derives a salted SHA-256 digest, and prints the ready to
# paste {% include challenge.html %} invocation. Standalone:
#
#   ruby script/new_challenge.rb
#   ruby script/new_challenge.rb --html  # encrypted private Markdown
#
# The digest is SHA-256(flag + salt), matching assets/js/challenge.js. The
# plaintext flag is never written anywhere. Existing ASCII boundary trimming
# is retained. Other ECMAScript trim characters at either boundary (including
# NBSP U+00A0 and BOM U+FEFF) are rejected: the browser removes them before hashing.
# --html encodes braces as numeric entities so hints pass the private Markdown
# Liquid guard while displaying the literal characters in the browser.

require 'digest'
require 'securerandom'
require 'io/console'
require 'cgi'

html = ARGV == ['--html']
abort('new_challenge: usage: ruby script/new_challenge.rb [--html]') unless ARGV.empty? || html

SOURCE = File.expand_path('..', __dir__)
# ECMAScript WhiteSpace and LineTerminator, not Ruby's narrower String#strip.
ECMASCRIPT_TRIM_CHAR = /[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

def prompt(label)
  print "#{label}: "
  $stdout.flush
  $stdin.gets.to_s.strip
end

id = prompt('Challenge id (required, e.g. assignment000009-0)')
abort('new_challenge: id is required') if id.empty?
abort('new_challenge: use 1-128 letters, digits, hyphens and underscores in the id') unless id.match?(/\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z/)
abort('new_challenge: reserved id') if %w[__proto__ prototype constructor].include?(id)

if $stdin.tty?
  print 'Flag (hidden): '
  $stdout.flush
  flag = $stdin.noecho { $stdin.gets.to_s.strip }
  puts
else
  flag = prompt('Flag (stdin)')
end
abort('new_challenge: flag is required') if flag.empty?
if ECMASCRIPT_TRIM_CHAR.match?(flag[0]) || ECMASCRIPT_TRIM_CHAR.match?(flag[-1])
  abort('new_challenge: flag cannot have surrounding Unicode whitespace (the browser trims it)')
end
abort('new_challenge: flag must fit in 4096 UTF-16 code units') if flag.encode('UTF-16LE').bytesize > 8192

hints = prompt('Hints, pipe separated, blank for none (max 3)')

hint_list = hints.split('|').map(&:strip).reject(&:empty?)
abort('new_challenge: provide at most 3 hints') if hint_list.length > 3
if !html && (hints.match?(/["\\\\]/) || hints.include?('{%') || hints.include?('{{'))
  abort('new_challenge: include hints cannot contain quotes, backslashes or Liquid delimiters; use --html for private Markdown')
end

# Refuse ids that already ship on the site.
existing = Dir.glob(File.join(SOURCE, '_posts', '**', '*.md')).sort +
           Dir.glob(File.join(SOURCE, '_drafts', '**', '*')).sort
existing.each do |path|
  text = begin
    File.read(path, encoding: 'UTF-8')
  rescue StandardError
    next
  end
  next unless text.include?("challenge.html id=\"#{id}\"") || text.include?("id=\"flag-#{id}\"") || text.match?(/key:\s*#{Regexp.escape(id.split('-').first)}\b/)

  abort("new_challenge: id #{id} already appears in #{path.sub("#{SOURCE}/", '')}")
end

salt = SecureRandom.hex(16)
digest = Digest::SHA256.hexdigest(flag + salt)

parts = ["id=\"#{id}\"", "hash=\"#{digest}\"", "salt=\"#{salt}\""]
parts << "hints=\"#{hint_list.join('|')}\"" unless hint_list.empty?

puts
puts 'Paste this into the post where the challenge belongs:'
puts
if html
  escape = ->(value) { CGI.escapeHTML(value).gsub('{', '&#123;').gsub('}', '&#125;') }
  input_id = escape.call("flag-#{id}")
  puts <<~HTML
    <form class="flag-check" data-flag-check data-sha256="#{escape.call(digest)}" data-salt="#{escape.call(salt)}">
      <label for="#{input_id}">Enter the flag</label>
      <div class="flag-check__controls">
        <input id="#{input_id}" data-flag-input type="text" autocomplete="off" autocapitalize="none" spellcheck="false">
        <button type="submit" disabled>Check flag</button>
      </div>
      <output for="#{input_id}" aria-live="polite">The check runs locally in your browser.</output>
      <noscript>The local SHA-256 checker requires JavaScript.</noscript>
    </form>
  HTML
  hint_list.each_with_index do |hint, index|
    puts %(<p class="challenge-hint" data-hint="#{index + 1}" data-hint-for="#{escape.call(id)}" hidden>#{escape.call(hint)}</p>)
  end
else
  puts "{% include challenge.html #{parts.join(' ')} %}"
end
puts
puts "salted digest: SHA-256(flag + #{salt}) = #{digest}"
puts 'The output contains the digest, not the answer.'
