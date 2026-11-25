from jira_assignee_time import build_periods, business_hours_between, parse_date


def entry(date, field, before=None, after=None, label=None):
    return {"created": date + "+01:00", "items": [
        {"fieldId": field, "from": before, "to": after, "toString": label or after}
    ]}


def issue(owner="a"):
    return {"fields": {"created": "2026-10-30T09:00:00+01:00",
                       "assignee": {"accountId": owner, "displayName": owner} if owner else None}}


def test_never_reassigned():
    done, intervals = build_periods(issue(), [entry("2026-11-03T12:00:00", "status", after="Done")], "2026-11")
    assert intervals[0][0] == "a"
    assert intervals[0][2].day == 30
    assert intervals[0][3] == done


def test_started_unassigned():
    changes = [entry("2026-11-02T09:00:00", "assignee", after="a"),
               entry("2026-11-03T12:00:00", "status", after="Done")]
    _, intervals = build_periods(issue(), changes, "2026-11", clip_month=True)
    assert [r[0] for r in intervals] == [None, "a"]
    assert intervals[0][2].day == 1


def test_changes_and_reopened():
    changes = [
        entry("2026-11-05T12:00:00", "status", after="Done"),
        entry("2026-11-02T09:00:00", "assignee", "a", "b"),
        entry("2026-11-06T09:00:00", "status", after="Reopened"),
        entry("2026-11-09T09:00:00", "assignee", "b", "a"),
        entry("2026-11-12T12:00:00", "status", after="Done"),
        entry("2026-12-01T00:00:00", "status", after="Done"),
    ]
    done, intervals = build_periods(issue(), changes, "2026-11")
    assert done.day == 12
    assert [r[0] for r in intervals] == ["a", "b", "a"]


def test_weekend_ignored():
    a = parse_date("2026-11-06T15:00:00+01:00")
    b = parse_date("2026-11-09T10:30:00+01:00")
    assert business_hours_between(a, b) == 4.5


def test_bulk_history_unix_timestamp():
    done = parse_date("2026-11-03T12:00:00+01:00")
    for timestamp in [int(done.timestamp()), int(done.timestamp() * 1000)]:
        change = entry("2026-11-03T12:00:00", "status", after="Done")
        change["created"] = timestamp
        observed, intervals = build_periods(issue(), [change], "2026-11")
        assert observed == done
        assert intervals[0][3] == done


def test_search_does_not_filter_issue_type_by_default():
    from jira_assignee_time import search_issues

    class JiraFixture:
        def request(self, path, params):
            assert path == "search/jql"
            assert "project = OP" in params["jql"]
            assert 'status CHANGED TO "Done"' in params["jql"]
            assert "issuetype IN" not in params["jql"]
            return {"issues": [], "isLast": True}

    assert search_issues(JiraFixture(), "OP", [], ["Done"], "2026-11") == []


def test_monthly_business_hours_merge_overlap_and_stop_at_reassignment():
    from jira_assignee_time import unique_business_hours

    first = [
        entry("2026-11-02T08:00:00", "assignee", after="a"),
        entry("2026-11-02T13:30:00", "assignee", before="a", after="b"),
        entry("2026-11-03T15:00:00", "status", after="Done"),
    ]
    second = [
        entry("2026-11-02T11:00:00", "assignee", after="a"),
        entry("2026-11-02T20:00:00", "status", after="Done"),
    ]
    parts = []
    for changes in (first, second):
        _, intervals = build_periods(issue(), changes, "2026-11", clip_month=True)
        parts.extend((start, end) for account, _, start, end in intervals if account == "a")
    assert [business_hours_between(*pair) for pair in parts] == [4.5, 7]
    assert unique_business_hours(parts) == 9


def test_in_progress_as_of_and_reassignment():
    ticket = issue("b")
    ticket["fields"]["status"] = {"name": "In Progress", "statusCategory": {"key": "indeterminate"}}
    changes = [
        entry("2026-11-02T10:00:00", "assignee", after="a"),
        entry("2026-11-03T12:00:00", "assignee", before="a", after="b"),
    ]
    cutoff = parse_date("2026-11-04T14:00:00+01:00")
    done, intervals = build_periods(ticket, changes, "2026-11", clip_month=True, as_of=cutoff)
    assert done is None
    assert intervals[1][0] == "a"
    assert intervals[1][3] == parse_date("2026-11-03T12:00:00+01:00")
    assert intervals[-1][3] == cutoff


def test_done_in_activity_stops_at_done():
    ticket = issue()
    ticket["fields"]["status"] = {"name": "Done", "statusCategory": {"key": "done"}}
    changes = [entry("2026-11-02T12:00:00", "status", after="Done")]
    done, intervals = build_periods(ticket, changes, "2026-11", clip_month=True,
                                    as_of=parse_date("2026-11-04T14:00:00+01:00"))
    assert intervals[-1][3] == done
