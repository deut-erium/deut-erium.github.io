# frozen_string_literal: true

# Generate /challenges.json: the build-time index of every embedded flag
# challenge.
#
# After Jekyll writes the site, scan the rendered HTML for data-flag-check
# forms and their data-flag-input ids, then write a small JSON array the
# /scoreboard/ page fetches so it can also list challenges this device has
# not solved yet. Local scan only; nothing is fetched or sent.

require 'json'

Jekyll::Hooks.register :site, :post_write do |site|
  dest = site.dest.to_s
  next if dest.empty?

  challenges = []
  Dir.glob(File.join(dest, '**', '*.html')).sort.each do |path|
    html = begin
      File.read(path, encoding: 'UTF-8')
    rescue StandardError
      next
    end
    next unless html.include?('data-flag-check')

    route = '/' + path.delete_prefix(dest).delete_prefix(File::SEPARATOR)
    route = route.sub(%r{(?:^|/)index\.html\z}, '/')
    title = html[%r{<title>(.*?)</title>}m, 1].to_s.split(' / ').first.to_s.strip
    html.scan(%r{<input[^>]*\bdata-flag-input\b[^>]*>}).each do |tag|
      id = tag[/\bid="flag-([^"]+)"/, 1] || tag[/\bid="([^"]+)"/, 1]
      next unless id

      challenges << { 'id' => id, 'page' => route, 'title' => title.empty? ? id : title }
    end
  end

  File.write(File.join(dest, 'challenges.json'), JSON.pretty_generate(challenges) << "\n")
  Jekyll.logger.info('challenges_index:', "wrote #{challenges.length} challenge ids to /challenges.json")
end
