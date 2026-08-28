import readline from 'node:readline';
import katex from 'katex';

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line) continue;

  let request;
  try {
    request = JSON.parse(line);
    const html = katex.renderToString(request.tex, {
      displayMode: Boolean(request.display),
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: false,
      trust: false
    });
    process.stdout.write(`${JSON.stringify({ html })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      tex: request?.tex
    })}\n`);
  }
}
