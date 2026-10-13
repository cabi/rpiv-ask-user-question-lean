// External request helper. Hits the weather API on every call, no caching.
async function getWeather(city) {
	const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`weather request failed: ${res.status}`);
	}
	return res.json();
}

module.exports = { getWeather };
