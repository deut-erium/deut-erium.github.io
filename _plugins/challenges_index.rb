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
  by_hash = {}
  Dir.glob(File.join(dest, '**', '*.html')).sort.each do |path|
    html = begin
      File.read(path, encoding: 'UTF-8')
    rescue StandardError
      next
    end
    next unless html.include?('data-flag-check')

    route = '/' + path.delete_prefix(dest).delete_prefix(File::SEPARATOR)
    route = route.sub(%r{(?:^|/)index\.html\z}, '/')
    page_title = html[%r{<title>(.*?)</title>}m, 1].to_s.split(' / ').first.to_s.strip
    html.scan(%r{<form[^>]*data-flag-check[^>]*>}).each do |form_html|
      hash = form_html[/\bdata-sha256="([^"]+)"/, 1].to_s
      salt = form_html[/\bdata-salt="([^"]+)"/, 1]
      # nearest preceding heading carries the challenge's real name
      pos = html.index(form_html)
      headings = html[0...pos].scan(/<h([23])[^>]*>(.*?)<\/h\1>/m).map { |cap| cap[1].gsub(/<[^>]+>/, '').strip }
      name = headings.last.to_s
      name = name.empty? ? (page_title.empty? ? nil : page_title) : name
      id_m = html[pos..pos + 400][/\bid="flag-([^"]+)"/, 1]
      next unless id_m

      entry = { 'id' => id_m, 'page' => route, 'title' => name || id_m }
      entry['sha256'] = hash unless hash.empty?
      entry['salt'] = salt unless salt.to_s.empty?
      entry = { 'id' => id_m, 'page' => route, 'title' => name || id_m }
      entry['sha256'] = hash unless hash.empty?
      entry['salt'] = salt unless salt.to_s.empty?
      if !hash.empty? && by_hash.key?(hash)
        by_hash[hash]['aliases'] << id_m
      else
        by_hash[hash] = entry unless hash.empty?
        challenges << entry
      end
    end
  end

  File.write(File.join(dest, 'challenges.json'), JSON.pretty_generate(challenges) << "\n")

  board = File.join(dest, 'scoreboard', 'index.html')
  if File.file?(board)
    html = File.read(board, encoding: 'UTF-8')
    embedded = '<script id="scoreboard-known" type="application/json">' + JSON.generate(challenges) + '</script>'
    html = html.sub('<script id="scoreboard-known" type="application/json">[]</script>', embedded)
    File.write(board, html)
  end

  Jekyll.logger.info('challenges_index:', "wrote #{challenges.length} challenge ids to /challenges.json")
end
