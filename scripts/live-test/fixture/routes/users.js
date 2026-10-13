// 25 hardcoded users, no pagination yet.
const USERS = Array.from({ length: 25 }, (_, i) => ({
	id: i + 1,
	name: `User ${i + 1}`,
	email: `user${i + 1}@example.com`,
	role: i % 3 === 0 ? "admin" : "member",
}));

function listUsers() {
	return USERS;
}

module.exports = { listUsers };
