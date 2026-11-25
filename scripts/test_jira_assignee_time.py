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
