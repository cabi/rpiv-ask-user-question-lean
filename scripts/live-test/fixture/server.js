const http = require("http");
const { listUsers } = require("./routes/users");
const { listNotes, searchNotes } = require("./routes/notes");
const { getWeather } = require("./lib/fetch");

const PORT = 3000;

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");
	if (url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html" });
		return res.end(require("fs").readFileSync("public/index.html"));
	}
	if (url.pathname === "/users") {
		return send(res, 200, listUsers());
	}
	if (url.pathname === "/notes") {
		const q = url.searchParams.get("q");
		return send(res, 200, q ? searchNotes(q) : listNotes());
	}
	if (url.pathname === "/weather") {
		const data = await getWeather(url.searchParams.get("city") || "berlin");
		return send(res, 200, data);
	}
	res.writeHead(404);
	res.end("not found");
});

function send(res, status, body) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

server.listen(PORT, () => {
	console.log(`notes-api listening on ${PORT}`);
});
