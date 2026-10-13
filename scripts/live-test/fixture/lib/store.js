// In-memory note store with a naive linear search.
const NOTES = [
	{ id: 1, title: "Grocery list", body: "milk, eggs, bread" },
	{ id: 2, title: "Workout plan", body: "mon: legs, wed: push, fri: pull" },
	{ id: 3, title: "Books to read", body: "ddd, clean architecture, tiny habits" },
	{ id: 4, title: "Meeting notes", body: "quarterly review, roadmap, hiring" },
	{ id: 5, title: "Recipe", body: "pasta with tomato sauce and basil" },
];

function listNotes() {
	return NOTES;
}

function searchNotes(q) {
	const needle = q.toLowerCase();
	// Scans every note, splits body repeatedly per query.
	return NOTES.filter(
		(n) =>
			n.title.toLowerCase().includes(needle) ||
			n.body
				.toLowerCase()
				.split(/[\s,]+/)
				.some((word) => word === needle),
	);
}

module.exports = { listNotes, searchNotes };
