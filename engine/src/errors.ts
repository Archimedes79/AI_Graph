// Two answers that more than one layer gives, said once.
//
// A project folder says them when it reads, a directory listing when it lists,
// and the server turns both into a status. They used to be declared three
// times under two names, and the route that mapped them to 404 had to ask for
// each copy by its module.

/** What was asked for is not there. */
export class NotFound extends Error {}

/** What is there is not a graph: a folder without a graph.json, a file that is something else. */
export class NotAGraph extends Error {}
