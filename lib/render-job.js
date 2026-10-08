// One render job (a PNG, or a video) in a process of its own. resvg aborts the whole process on some drawings
// (anything clipped or masked that lies entirely outside the picture, in every resvg version so far), and that
// must not take the canvas or the MCP server down with it. Reads the job as JSON on stdin.
//   {kind: "png", svg, zoom?}  -> the PNG on stdout
//   {kind: "mp4", doc, style, out, options}  -> "progress <0..1>" lines on stdout, then "done <json>"
let input = '';
for await (const chunk of process.stdin) input += chunk;
const job = JSON.parse(input);

if (job.kind === 'png') {
  const [{ Resvg }, { emojify }] = await Promise.all([import('@resvg/resvg-js'), import('./emoji.js')]);
  const font = { loadSystemFonts: true };
  process.stdout.write(new Resvg(emojify(job.svg, Resvg, font, 'Arial'), { fitTo: { mode: 'zoom', value: job.zoom ?? 2 }, font }).render().asPng());
} else if (job.kind === 'mp4') {
  const { toMp4 } = await import('./video.js');
  const r = await toMp4(job.doc, job.style, job.out, { ...job.options, onProgress: (p) => process.stdout.write(`progress ${p}\n`) });
  process.stdout.write(`done ${JSON.stringify(r)}\n`);
}
