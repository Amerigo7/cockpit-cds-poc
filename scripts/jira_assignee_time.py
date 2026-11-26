#!/usr/bin/env python3
"""Report time in Jira's Assignee field, with reported worklogs for comparison."""
import argparse
import base64
import csv
import json
import logging
import os
import re
import time
from collections import defaultdict
from datetime import datetime, time as clock_time, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
ROOT = "https://api.atlassian.com/ex/jira/7fc30b42-e831-4c22-aef3-5e0bbb7c692e/rest/api/3/"


def parse_date(value):
    if isinstance(value, (int, float)):
        # Bulk changelog uses Unix timestamps; individual histories use ISO.
        seconds = value / 1000 if abs(value) >= 100_000_000_000 else value
        return datetime.fromtimestamp(seconds, PARIS)
    return datetime.fromisoformat(value).astimezone(PARIS)


def hours(start, end):
    return (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() / 3600


def month_bounds(month):
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Le mois doit être au format AAAA-MM.")
    start = datetime.fromisoformat(month + "-01").replace(tzinfo=PARIS)
    following = (start + timedelta(days=32)).replace(day=1)
    return start, following


def business_hours_between(start, end):
    start, end = start.astimezone(PARIS), end.astimezone(PARIS)
    day, total = start.date(), 0.0
    while day <= end.date():
        if day.weekday() < 5:
            left = max(start, datetime.combine(day, clock_time(9), PARIS))
            right = min(end, datetime.combine(day, clock_time(18), PARIS))
            if left < right:
                total += hours(left, right)
        day += timedelta(days=1)
    return total


def unique_business_hours(intervals):
    """Intersect the union of actual assignment intervals with Paris business hours."""
    merged = []
    for start, end in sorted(intervals, key=lambda pair: pair[0].timestamp()):
        if merged and start.timestamp() <= merged[-1][1].timestamp():
            if end.timestamp() > merged[-1][1].timestamp():
                merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return sum(business_hours_between(start, end) for start, end in merged)


def epic_breakdown(intervals):
    """Divide each covered segment evenly among its distinct epics."""
    events = defaultdict(list)
    for epic, start, end in intervals:
        events[start.timestamp()].append((epic, 1))
        events[end.timestamp()].append((epic, -1))
    active, totals = defaultdict(int), defaultdict(float)
    previous = None
    for when in sorted(events):
        if active and previous is not None:
            duration = business_hours_between(datetime.fromtimestamp(previous, PARIS), datetime.fromtimestamp(when, PARIS))
            if duration:
                for epic in active:
                    totals[epic] += duration / len(active)
        for epic, change in events[when]:
            active[epic] += change
            if not active[epic]:
                del active[epic]
        previous = when
    return totals


def load_epics(client, issues):
    # Jira parent points to the issue for a sub-task and to the epic for a story.
    by_key = {issue["key"]: issue["fields"] for issue in issues}
    parents = {(fields.get("parent") or {}).get("key") for fields in by_key.values()}
    visited = set(by_key)
    while parents - visited - {None}:
        pending = sorted(parents - visited - {None})
        parents = set()
        for start in range(0, len(pending), 40):
            batch = pending[start:start + 40]
            visited.update(batch)
            params = {"jql": "key IN (" + ",".join(map(quoted, batch)) + ")",
                      "fields": "summary,issuetype,parent", "maxResults": 100}
            seen = set()
            while True:
                page = client.request("search/jql", params)
                for issue in page["issues"]:
                    fields = issue["fields"]
                    by_key[issue["key"]] = fields
                    parents.add((fields.get("parent") or {}).get("key"))
                cursor = page.get("nextPageToken")
                if page.get("isLast") or not cursor:
                    break
                if cursor in seen:
                    raise ValueError("Pagination Jira des epics incomplète.")
                seen.add(cursor)
                params["nextPageToken"] = cursor
    result = {}
    for issue in issues:
        key, seen = issue["key"], set()
        while key in by_key and key not in seen:
            seen.add(key)
            fields = by_key[key]
            typ = fields.get("issuetype") or {}
            if typ.get("hierarchyLevel") == 1 or typ.get("name", "").casefold() == "epic":
                result[issue["key"]] = (key, fields.get("summary") or key)
                break
            key = (fields.get("parent") or {}).get("key")
    return result


def historical_progress(current_status, changes, boundary, progress_ids):
    status_id = changes[0][1].get("from") if changes else current_status.get("id")
    for when, change in changes:
        if when >= boundary:
            break
        status_id = change.get("to")
    return str(status_id) in progress_ids


def build_periods(issue, history, month, done_statuses=("Done",), clip_month=False, as_of=None, progress_ids=None):
    """Return the last in-month Done and the assignment intervals that precede it."""
    first, following = month_bounds(month)
    statuses = {value.casefold() for value in done_statuses}
    entries = sorted(history, key=lambda entry: parse_date(entry["created"]))
    transitions, assignments, status_changes = [], [], []
    for entry in entries:
        when = parse_date(entry["created"])
        for item in entry.get("items", []):
            field = (item.get("fieldId") or item.get("field") or "").lower()
            if field == "status":
                status_changes.append((when, item))
                if first <= when < following and (item.get("toString") or "").casefold() in statuses:
                    transitions.append(when)
            if field == "assignee":
                assignments.append((when, item))
    done = max((when for when in transitions if as_of is None or when <= as_of), default=None)
    current_status = issue["fields"].get("status") or {}
    ongoing = as_of is not None and (current_status.get("statusCategory") or {}).get("key") == "indeterminate"
    if as_of is not None and progress_ids is not None:
        ongoing = historical_progress(current_status, status_changes, as_of, progress_ids)
    end = min(as_of, following) if ongoing else done
    if end is None or end <= first:
        return None, []
    fields = issue["fields"]
    start = parse_date(fields["created"])
    current = fields.get("assignee") or {}
    account, name = current.get("accountId"), current.get("displayName")
    if assignments:
        initial = assignments[0][1]
        account, name = initial.get("from"), initial.get("fromString")
    intervals = []

    def append(a, b, assigned, label):
        if clip_month:
            a = max(a, first)
        if a < b:
            intervals.append((assigned, label or ("Non assigné" if not assigned else assigned), a, b))

    for when, change in assignments:
        if when > end:
            break
        append(start, when, account, name)
        start = max(start, when)
        account, name = change.get("to"), change.get("toString")
    append(start, end, account, name)
    return done, intervals


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Jira:
    def __init__(self, email, token):
        encoded = base64.b64encode(f"{email}:{token}".encode()).decode()
        self.opener = build_opener(NoRedirect())
        self.headers = {"Authorization": f"Basic {encoded}", "Accept": "application/json"}

    def request(self, path, params=None, body=None):
        url = ROOT + path + (("?" + urlencode(params)) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        req = Request(url, data=data, headers={**self.headers, "Content-Type": "application/json"})
        for attempt in range(5):
            try:
                with self.opener.open(req, timeout=12) as response:
                    return json.load(response)
            except HTTPError as error:
                if error.code != 429 or attempt == 4:
                    raise
                retry = error.headers.get("Retry-After", "")
                try:
                    wait = float(retry)
                except ValueError:
                    from email.utils import parsedate_to_datetime
                    try:
                        wait = (parsedate_to_datetime(retry) - datetime.now(timezone.utc)).total_seconds()
                    except (TypeError, ValueError):
                        wait = 2 ** attempt
                delay = max(2 ** attempt, wait)
                logging.warning("Jira limite le débit. Nouvelle tentative dans %.0f s.", delay)
                time.sleep(delay)


def quoted(value):
    return json.dumps(value, ensure_ascii=False)


def search_issues(client, project, types, statuses, month, ongoing_assignee=None, progress_ids=None):
    start, end = month_bounds(month)
    project = project.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", project):
        raise ValueError("Clé de projet invalide.")
    window = f'DURING ("{start:%Y-%m-%d %H:%M}", "{end:%Y-%m-%d %H:%M}")'
    changes = " OR ".join(f"status CHANGED TO {quoted(status)} {window}" for status in statuses)
    assignee_filter = ""
    if ongoing_assignee:
        assignee_filter = f" AND assignee WAS {quoted(ongoing_assignee)} {window}"
        progress = 'statusCategory = "In Progress"' if progress_ids is None else (
            f"status WAS IN ({','.join(map(quoted, sorted(progress_ids)))}) {window}" if progress_ids else ""
        )
        if progress:
            changes += f" OR ({progress})"
    type_filter = f" AND issuetype IN ({','.join(map(quoted, types))})" if types else ""
    jql = f"project = {project}{type_filter}{assignee_filter} AND ({changes}) ORDER BY key"
    params = {"jql": jql, "fields": "summary,issuetype,status,assignee,created,timespent,parent", "maxResults": 100}
    issues, seen = {}, set()
    while True:
        page = client.request("search/jql", params)
        issues.update((issue["key"], issue) for issue in page["issues"])
        cursor = page.get("nextPageToken")
        if page.get("isLast") or not cursor:
            break
        if cursor in seen:
            raise ValueError("Pagination de recherche Jira incomplète.")
        seen.add(cursor)
        params["nextPageToken"] = cursor
    logging.info("%d tickets candidats.", len(issues))
    return list(issues.values())


def pages(client, path, key, extra=None):
    offset = 0
    while True:
        page = client.request(path, {**(extra or {}), "startAt": offset, "maxResults": 100})
        batch = page[key]
        yield from batch
        offset += len(batch)
        if page.get("isLast") or offset >= page["total"]:
            break
        if not batch:
            raise ValueError(f"Pagination Jira incomplète sur {path}.")


def fetch_changelogs(client, issues):
    id_to_key = {str(issue["id"]): issue["key"] for issue in issues}
    keys = list(id_to_key.values())
    histories = defaultdict(list)
    for offset in range(0, len(keys), 1000):
        batch = keys[offset:offset + 1000]
        body = {"issueIdsOrKeys": batch, "fieldIds": ["assignee", "status"], "maxResults": 1000}
        seen = set()
        try:
            while True:
                result = client.request("changelog/bulkfetch", body=body)
                for entry in result["issueChangeLogs"]:
                    key = id_to_key.get(str(entry["issueId"]))
                    if key:
                        histories[key].extend(entry["changeHistories"])
                cursor = result.get("nextPageToken")
                if not cursor:
                    break
                if cursor in seen:
                    raise ValueError("Pagination de l’historique Jira incomplète.")
                seen.add(cursor)
                body["nextPageToken"] = cursor
        except HTTPError as error:
            if error.code not in (403, 404):
                raise
            logging.info("Historique groupé indisponible (%s). Lecture ticket par ticket.", error.code)
            for key in batch:
                histories.pop(key, None)
        for key in batch:
            if key not in histories:
                logging.info("Historique groupé absent pour %s. Vérification individuelle.", key)
                histories[key] = list(pages(client, "issue/" + quote(key, safe="") + "/changelog", "values"))
    logging.info("%d entrées d’historique.", sum(map(len, histories.values())))
    return histories


def fetch_worklogs(client, key, month=None):
    totals = defaultdict(int)
    extra = None
    if month:
        first, following = month_bounds(month)
        extra = {"startedAfter": int(first.timestamp() * 1000), "startedBefore": int(following.timestamp() * 1000)}
    for log in pages(client, "issue/" + quote(key, safe="") + "/worklog", "worklogs", extra):
        if month and not parse_date(log["started"]).strftime("%Y-%m") == month:
            continue
        totals[(log.get("author") or {}).get("accountId")] += log.get("timeSpentSeconds", 0)
    return totals


def report(client, project, types, statuses, month, assignee=None, business=False, clip_month=False, as_of=None):
    progress_ids = None
    if as_of and month < datetime.now(PARIS).strftime("%Y-%m"):
        type_statuses = client.request("project/" + quote(project, safe="") + "/statuses")
        progress_ids = {str(status["id"]) for typ in type_statuses for status in typ["statuses"]
                        if (status.get("statusCategory") or {}).get("key") == "indeterminate"}
    issues = search_issues(client, project, types, statuses, month, assignee if as_of else None, progress_ids)
    histories = fetch_changelogs(client, issues)
    details, tickets, people = [], [], {}
    person_intervals = defaultdict(list)
    for issue in issues:
        key, fields = issue["key"], issue["fields"]
        history = histories[key]
        done, intervals = build_periods(issue, history, month, statuses, clip_month, as_of, progress_ids)
        if not intervals:
            logging.info("%s ignoré : aucune transition Done confirmée dans le mois.", key)
            continue
        selected = {}
        for account, name, start, end in intervals:
            if assignee and assignee.casefold() not in ((account or "").casefold(), name.casefold()):
                continue
            calendar = hours(start, end)
            working = business_hours_between(start, end) if business else None
            detail = dict(key=key, summary=fields["summary"], issuetype=fields["issuetype"]["name"],
                          assignee_accountId=account, assignee_name=name, start=start.isoformat(), end=end.isoformat(),
                          hours_calendar=round(calendar, 2), hours_business=round(working, 2) if business else None)
            details.append(detail)
            person_intervals[account].append((start, end))
            subtotal = selected.setdefault(account, [name, 0.0, 0.0])
            subtotal[1] += calendar
            subtotal[2] += working or 0
        if not selected:
            continue
        logs = {} if as_of else fetch_worklogs(client, key, month if clip_month else None)
        for account, (name, calendar, working) in selected.items():
            worklog = logs.get(account, 0) / 3600 if account else 0
            tickets.append(dict(key=key, summary=fields["summary"], issuetype=fields["issuetype"]["name"],
                                done_date=done.isoformat() if done else None, assignee_name=name, hours_calendar=round(calendar, 2),
                                hours_business=round(working, 2) if business else None, worklog_hours=round(worklog, 2)))
            if as_of:
                status = fields.get("status") or {}
                if progress_ids is None:
                    tickets[-1]["status"] = status.get("name")
                    tickets[-1]["ongoing"] = (status.get("statusCategory") or {}).get("key") == "indeterminate"
                else:
                    changes = sorted(
                        ((parse_date(entry["created"]), item) for entry in history for item in entry.get("items", [])
                         if (item.get("fieldId") or item.get("field") or "").lower() == "status"),
                        key=lambda change: change[0]
                    )
                    ongoing = historical_progress(status, changes, as_of, progress_ids)
                    tickets[-1]["status"] = "En cours à la clôture" if ongoing else "Done"
                    tickets[-1]["ongoing"] = ongoing
            person = people.setdefault(account, [name, set(), 0.0, 0.0])
            person[1].add(key)
            person[2] += calendar
            person[3] += worklog
    totals = [dict(assignee_name=name, nb_tickets=len(keys), total_hours_calendar=round(cal, 2),
                   total_hours_business=round(unique_business_hours(person_intervals[account]), 2) if business else None,
                   total_worklog_hours=round(logged, 2))
              for account, (name, keys, cal, logged) in people.items()]
    logging.info("%d périodes et %d lignes par ticket.", len(details), len(tickets))
    result = dict(periods=details, tickets=tickets, people=totals, candidates=len(issues), as_of=as_of.isoformat() if as_of else None)
    if as_of:
        selected_keys = {ticket["key"] for ticket in tickets}
        epics = load_epics(client, [issue for issue in issues if issue["key"] in selected_keys])
        for ticket in tickets:
            ticket["epic_key"], ticket["epic_name"] = epics.get(ticket["key"], (None, "Non identifié"))
        groups = epic_breakdown((epics.get(item["key"], (None, "Non identifié"))[0], parse_date(item["start"]), parse_date(item["end"])) for item in details)
        for ticket in tickets:
            groups.setdefault(ticket["epic_key"], 0.0)
        names = {key: name for key, name in epics.values()}
        result["epics"] = [{"key": key, "name": names.get(key, "Non identifié"), "hours": value,
                            "tickets": sorted(t["key"] for t in tickets if t["epic_key"] == key)}
                           for key, value in sorted(groups.items(), key=lambda item: (item[0] is None, item[0] or ""))]
    return result


def write_csv(directory, data):
    formats = {
        "periods": ("assignment_periods", "key summary issuetype assignee_accountId assignee_name start end hours_calendar hours_business"),
        "tickets": ("assignment_by_ticket", "key summary issuetype done_date assignee_name hours_calendar hours_business worklog_hours"),
        "people": ("assignment_by_person", "assignee_name nb_tickets total_hours_calendar total_hours_business total_worklog_hours"),
    }
    directory.mkdir(parents=True, exist_ok=True)
    for name, (filename, fields) in formats.items():
        with (directory / (filename + ".csv")).open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields.split(), delimiter=";")
            writer.writeheader()
            for row in data[name]:
                writer.writerow({key: "'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value
                                 for key, value in row.items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="OP")
    parser.add_argument("--issue-types", default="", help="Filtre facultatif, tous les types par défaut.")
    parser.add_argument("--done-statuses", default="Done")
    parser.add_argument("--month", default=datetime.now(PARIS).strftime("%Y-%m"))
    parser.add_argument("--assignee")
    parser.add_argument("--business-hours", action="store_true")
    parser.add_argument("--clip-month", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--activity", action="store_true", help="Aperçu du mois en cours : Done et en cours, arrêté maintenant.")
    parser.add_argument("--out-dir", type=Path, default=Path("output"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        email, token = os.environ["JIRA_EMAIL"].strip(), os.environ["JIRA_API_TOKEN"].strip()
        if not email or not token:
            raise ValueError("Configurez JIRA_EMAIL et JIRA_API_TOKEN.")
        types = [value.strip() for value in args.issue_types.split(",") if value.strip()]
        statuses = [value.strip() for value in args.done_statuses.split(",") if value.strip()]
        if not statuses:
            raise ValueError("Précisez les statuts Jira.")
        now = datetime.now(PARIS)
        as_of = min(now, month_bounds(args.month)[1]) if args.activity else None
        if as_of and (not args.assignee or not args.json or args.month > now.strftime("%Y-%m")):
            raise ValueError("La vue activité exige un assignee, un mois commencé et --json.")
        data = report(Jira(email, token), args.project, types, statuses, args.month, args.assignee,
                      args.business_hours, args.clip_month or args.activity, as_of)
        if args.json:
            print(json.dumps(data, ensure_ascii=False))
        else:
            write_csv(args.out_dir, data)
    except HTTPError as error:
        parser.exit(1, f"Jira n’a pas terminé l’extraction (HTTP {error.code}). Vérifiez les droits du jeton.\n")
    except (KeyError, URLError, ValueError, TimeoutError) as error:
        parser.exit(1, f"Extraction incomplète : {error}\n")


if __name__ == "__main__":
    main()
