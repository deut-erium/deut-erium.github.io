# frozen_string_literal: true

# Challenge engine v2 authoring helper.
#
# Prompts for a flag, derives a salted SHA-256 digest, and prints the ready to
# paste {% include challenge.html %} invocation. Standalone:
#
#   ruby script/new_challenge.rb
#
# The digest is SHA-256(flag + salt), matching assets/js/challenge.js. The
# plaintext flag is never written anywhere.

require 'digest'
require 'securerandom'

SOURCE = File.expand_path('..', __dir__)

def prompt(label)
  print "#{label}: "
  $stdout.flush
  $stdin.gets.to_s.strip
end

id = prompt('Challenge id (required, e.g. assignment000009-0)')
abort('new_challenge: id is required') if id.empty?
abort('new_challenge: id must not contain quotes') if id.match?(/["']/)

flag = prompt('Flag (e.g. flag{lower_case_secret})')
abort('new_challenge: flag is required') if flag.empty?

hints = prompt('Hints, pipe separated, blank for none (max 3)')

hint_list = hints.split('|').map(&:strip).reject(&:empty?)
if hint_list.length > 3
  hint_list = hint_list.first(3)
  warn 'new_challenge: only the first 3 hints are kept'
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
  next unless text.include?("challenge.html id=\"#{id}\"") || text.match?(/key:\s*#{Regexp.escape(id.split('-').first)}\b/)

  abort("new_challenge: id #{id} already appears in #{path.sub("#{SOURCE}/", '')}")
end

salt = SecureRandom.hex(8)
digest = Digest::SHA256.hexdigest(flag + salt)

parts = ["id=\"#{id}\"", "hash=\"#{digest}\"", "salt=\"#{salt}\""]
parts << "hints=\"#{hint_list.join('|')}\"" unless hint_list.empty?

puts
puts 'Paste this into the post where the challenge belongs:'
puts
puts "{% include challenge.html #{parts.join(' ')} %}"
puts
puts "salted digest: SHA-256(flag + #{salt}) = #{digest}"
puts 'plaintext answer is not stored anywhere.'
