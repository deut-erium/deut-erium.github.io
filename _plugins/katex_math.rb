# frozen_string_literal: true

require "json"
require "open3"
require "kramdown/converter"

module FaultRegister
  class KatexRenderer
    def initialize
      script = File.expand_path("../script/katex-renderer.mjs", __dir__)
      package = File.expand_path("../node_modules/katex/package.json", __dir__)
      unless File.file?(package)
        raise "KaTeX build dependency is missing. Run `npm ci` before Jekyll."
      end

      @stdin, @stdout, @stderr, @wait_thread = Open3.popen3("node", script)
      @stdin.set_encoding(Encoding::UTF_8)
      @stdout.set_encoding(Encoding::UTF_8)
      @stderr.set_encoding(Encoding::UTF_8)
      at_exit { close }
    end

    def render(tex, display)
      @stdin.puts(JSON.generate(tex: tex, display: display))
      @stdin.flush
      response_line = @stdout.gets
      unless response_line
        details = @stderr.read
        raise "KaTeX renderer stopped unexpectedly#{details.empty? ? "" : ": #{details}"}"
      end

      response = JSON.parse(response_line)
      if response["error"]
        raise "KaTeX could not render #{tex.inspect}: #{response["error"]}"
      end

      response.fetch("html")
    end

    def close
      return unless @stdin

      @stdin.close unless @stdin.closed?
      @stdout.close unless @stdout.closed?
      @stderr.close unless @stderr.closed?
      @wait_thread.join(1)
    rescue IOError, Errno::EPIPE
      nil
    ensure
      @stdin = nil
    end
  end
end

module Kramdown
  module Converter
    module MathEngine
      module FaultRegisterKatex
        def self.call(converter, element, options)
          display = element.options[:category] == :block
          html = renderer.render(element.value, display)
          attributes = element.attr.dup
          attributes.delete("display")
          attributes.delete("xmlns")
          html.insert(html =~ /[[:space:]>]/, converter.html_attributes(attributes))
          display ? "#{" " * options[:indent]}#{html}\n" : html
        end

        def self.renderer
          @renderer ||= FaultRegister::KatexRenderer.new
        end
      end
    end

    # Reuse kramdown's built-in `mathjax` engine key so Jekyll does not try to
    # require a separately packaged kramdown-math-* gem. This registration
    # replaces the built-in delimiter emitter with build-time KaTeX output.
    add_math_engine(:mathjax, MathEngine::FaultRegisterKatex)
  end
end
