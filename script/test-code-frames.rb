# frozen_string_literal: true

require "bundler/setup"
require "jekyll"
require_relative "../_plugins/code_frames"

HIGHLIGHTED = "<span class=\"nb\">print</span>(&quot;x&quot;)\n"
SOURCE = "print(\"x\")\n"

cases = {
  "canonical" => <<~HTML,
    <div class="language-python highlighter-rouge"><div class="highlight"><pre class="highlight"><code>#{HIGHLIGHTED}</code></pre></div></div>
  HTML
  "reordered and extended classes" => <<~HTML,
    <div data-kind="code" class="highlighter-rouge extra language-python"><div aria-label="syntax" class="extra highlight"><pre data-lines="1" class="highlight extra"><code data-source="raw">#{HIGHLIGHTED}</code></pre></div></div>
  HTML
  "single-quoted attributes" => <<~HTML,
    <div class='highlighter-rouge language-python'><div class='highlight'><pre class='highlight'><code>#{HIGHLIGHTED}</code></pre></div></div>
  HTML
  "spaced attributes" => <<~HTML,
    <div class = "language-python   highlighter-rouge"><div class = "highlight"><pre class = "highlight"><code>#{HIGHLIGHTED}</code></pre></div></div>
  HTML
  "uppercase attribute names" => <<~HTML
    <div CLASS="language-python highlighter-rouge"><div CLASS="highlight"><pre CLASS="highlight"><code>#{HIGHLIGHTED}</code></pre></div></div>
  HTML
}.freeze

cases.each do |name, input|
  output = Jekyll::CodeFrames.render(input)
  raise "#{name}: frame missing" unless output.scan("data-code-frame").length == 1
  raise "#{name}: language missing" unless output.include?('data-language="python"')
  raise "#{name}: highlighted source changed" unless output.include?("<code>#{HIGHLIGHTED}</code>")
  hash = Digest::SHA256.hexdigest(SOURCE)
  raise "#{name}: source hash changed" unless output.include?(%[data-source-sha256="#{hash}"])
end

invalid = [
  '<div class="language-python"><div class="highlight"><pre class="highlight"><code>x</code></pre></div></div>',
  '<div class="language-python highlighter-rouge"><div><pre class="highlight"><code>x</code></pre></div></div>',
  '<div class="language-python highlighter-rouge"><div class="highlight"><pre><code>x</code></pre></div></div>',
  '<div data-class="language-python highlighter-rouge"><div data-class="highlight"><pre data-class="highlight"><code>x</code></pre></div></div>',
  '<div aria-class="language-python highlighter-rouge"><div aria-class="highlight"><pre aria-class="highlight"><code>x</code></pre></div></div>',
  %q(<div data-x='class="language-python highlighter-rouge"'><div data-x='class="highlight"'><pre data-x='class="highlight"'><code>x</code></pre></div></div>),
  '<div class="language-python highlighter-rouge" class="other"><div class="highlight"><pre class="highlight"><code>x</code></pre></div></div>',
  '<div class="language-python language-ruby highlighter-rouge"><div class="highlight"><pre class="highlight"><code>x</code></pre></div></div>'
].freeze
invalid.each_with_index do |input, index|
  raise "invalid #{index}: transformed" unless Jekyll::CodeFrames.render(input) == input
end

puts "Validated #{cases.length} accepted Rouge variants and #{invalid.length} rejected variants."
