#!/usr/bin/env ruby
# frozen_string_literal: true

# Internal converter for blog.py encrypt. Input is a private body, not a Jekyll
# document. Raw HTML is trusted; this converter is not a sanitizer. Python owns
# the mode-0600 sibling output file and suppresses all child diagnostics.
begin
  require "bundler/setup"
  require "kramdown"
  require "kramdown-parser-gfm"
  require_relative "../_plugins/katex_math"

  raise ArgumentError unless ARGV.length == 1

  source = File.read(ARGV.fetch(0), encoding: "UTF-8")
  raise ArgumentError unless source.valid_encoding?

  # Repeat Python's conservative checks on the bytes actually being converted.
  # Leading --- (even a horizontal rule) and Liquid inside code are unsupported.
  raise ArgumentError if source.match?(/\A\uFEFF?\s*(?:---[ \t]*(?:\r?\n|\z)|%YAML\b|%TAG\b)/)
  raise ArgumentError if source.include?("{{") || source.include?("{%")

  html = Kramdown::Document.new(source, input: "GFM", header_offset: 1,
                               math_engine: "mathjax", syntax_highlighter: "rouge").to_html
  STDOUT.write(html)
rescue StandardError, LoadError
  # KaTeX errors can quote the private TeX. Never expose an exception or body.
  exit 1
end
