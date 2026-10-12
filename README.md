# Northstar student registration

Run the website with Node.js (no packages to install):

```sh
node server.js
```

Open <http://127.0.0.1:3000>. Registrations are saved by the server in
`data/registrations.json` in this project folder. The registrations list is
loaded from that file, and the page can also export its contents as a CSV file.
Use **Clear all** on the page to remove the saved registrations.

The server listens on `127.0.0.1` by default, so it is available only on this
computer. Student data is private and should not be committed or publicly
exposed; the generated `data/` directory is ignored by Git.
