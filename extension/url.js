export function youtubeUrl(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Use an HTTPS YouTube video link.");
  let id;
  if (url.hostname === "youtu.be") id = url.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(url.hostname)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = /^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  }
  if (!/^[\w-]{11}$/.test(id || "")) throw new Error("Paste a YouTube video or Shorts link, not a playlist or channel.");
  return `https://www.youtube.com/watch?v=${id}`;
}
