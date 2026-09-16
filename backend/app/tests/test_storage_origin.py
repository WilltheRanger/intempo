"""The host check that was missing — see `services/storage_origin`.

Every case here was **accepted** by the old path-only check in
`calibration._assert_audio_url_owned_by`, which is why they are written out
one by one rather than folded into a loop.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.storage_origin import (
    is_owned_storage_url,
    origin_of,
    storage_origin,
)

BUCKET = "audio-uploads"
OURS = "proj.supabase.co:443"


def _url(host: str, user_id, *, scheme: str = "https", prefix: str = "sign") -> str:
    return f"{scheme}://{host}/storage/v1/object/{prefix}/{BUCKET}/{user_id}/take.wav"


def test_our_own_storage_is_allowed() -> None:
    uid = uuid4()
    assert is_owned_storage_url(
        _url("proj.supabase.co", uid), bucket=BUCKET, user_id=uid, expected_origin=OURS
    )


def test_an_attacker_controlled_host_is_refused() -> None:
    """The whole finding. Anybody can serve `/storage/v1/object/sign/...`."""
    uid = uuid4()
    assert not is_owned_storage_url(
        _url("evil.example.com", uid), bucket=BUCKET, user_id=uid, expected_origin=OURS
    )


def test_the_cloud_metadata_service_is_refused() -> None:
    uid = uuid4()
    assert not is_owned_storage_url(
        _url("169.254.169.254", uid, scheme="http"),
        bucket=BUCKET,
        user_id=uid,
        expected_origin=OURS,
    )


def test_loopback_is_refused() -> None:
    """An internal admin port on the same box is most of what an SSRF is for."""
    uid = uuid4()
    assert not is_owned_storage_url(
        _url("127.0.0.1:8000", uid, scheme="http"),
        bucket=BUCKET,
        user_id=uid,
        expected_origin=OURS,
    )


def test_our_host_on_another_port_is_refused() -> None:
    """Host alone is not the identity: another port is another service."""
    uid = uuid4()
    assert not is_owned_storage_url(
        _url("proj.supabase.co:8080", uid, scheme="http"),
        bucket=BUCKET,
        user_id=uid,
        expected_origin=OURS,
    )


def test_another_users_object_is_still_refused() -> None:
    """The check the old code did get right, kept."""
    assert not is_owned_storage_url(
        _url("proj.supabase.co", uuid4()),
        bucket=BUCKET,
        user_id=uuid4(),
        expected_origin=OURS,
    )


def test_another_bucket_is_refused() -> None:
    uid = uuid4()
    url = f"https://proj.supabase.co/storage/v1/object/sign/score-images/{uid}/p.jpg"
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=uid, expected_origin=OURS
    )


@pytest.mark.parametrize("scheme", ["file", "gopher", "ftp", "data"])
def test_only_http_schemes_are_allowed(scheme: str) -> None:
    uid = uuid4()
    assert not is_owned_storage_url(
        _url("proj.supabase.co", uid, scheme=scheme),
        bucket=BUCKET,
        user_id=uid,
        expected_origin=OURS,
    )


def test_a_deployment_with_no_storage_configured_refuses_everything() -> None:
    """Closed, not open. A build that cannot say where its storage is has no
    business fetching a URL a stranger chose."""
    uid = uuid4()
    assert not is_owned_storage_url(
        _url("proj.supabase.co", uid),
        bucket=BUCKET,
        user_id=uid,
        expected_origin=None,
    )
    assert storage_origin("") is None


# ---- traversal: the path checked must be the path fetched -----------------


def test_a_dotdot_out_of_my_own_folder_is_refused() -> None:
    """`..` walked straight through the prefix test, which is a string compare.

    `urlparse` does not normalise a path, so this starts with the required
    prefix and was accepted — and `httpx` normalises it away before the request
    leaves, so the path *checked* and the path *fetched* were different:

        checked:  /storage/v1/object/sign/audio-uploads/<me>/../<other>/take.wav
        fetched:  /storage/v1/object/sign/audio-uploads/<other>/take.wav
    """
    me, other = uuid4(), uuid4()
    url = (
        f"https://proj.supabase.co/storage/v1/object/sign/"
        f"{BUCKET}/{me}/../{other}/take.wav"
    )
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=me, expected_origin=OURS
    )


def test_a_dotdot_out_of_the_bucket_is_refused() -> None:
    """Two of them leave the bucket as well as the user.

    `/storage/v1/object/public/audio-uploads/<me>/../../other/s.wav` is sent by
    httpx as `/storage/v1/object/public/other/s.wav` — a different bucket
    entirely, under a prefix that needs no signature.
    """
    me = uuid4()
    url = (
        f"https://proj.supabase.co/storage/v1/object/public/"
        f"{BUCKET}/{me}/../../score-images/{me}/page.jpg"
    )
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=me, expected_origin=OURS
    )


@pytest.mark.parametrize("dots", ["%2e%2e", "%2E%2E", ".."])
def test_an_encoded_dotdot_is_refused_too(dots: str) -> None:
    """Encoded and raw fail differently, so both are refused.

    A raw `..` is resolved by the client before it sends; `%2e%2e` is sent
    encoded for the *server* to resolve. The two disagree about who normalises,
    and neither of them is this deployment — so the only safe answer is that a
    storage URL contains no traversal at all.
    """
    me, other = uuid4(), uuid4()
    url = (
        f"https://proj.supabase.co/storage/v1/object/sign/"
        f"{BUCKET}/{me}/{dots}/{other}/take.wav"
    )
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=me, expected_origin=OURS
    )


@pytest.mark.parametrize("sep", ["%2f", "%2F", "%5c"])
def test_an_encoded_separator_is_refused(sep: str) -> None:
    """An encoded separator makes the server split the path differently.

    The comparison here is against one string; the server resolves another. The
    same class as `..`, and a real storage URL never needs it.
    """
    me, other = uuid4(), uuid4()
    url = (
        f"https://proj.supabase.co/storage/v1/object/sign/"
        f"{BUCKET}/{me}{sep}..{sep}{other}/take.wav"
    )
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=me, expected_origin=OURS
    )


def test_a_single_dot_segment_is_refused() -> None:
    """`/./` does not escape, but it still makes the two paths differ."""
    me = uuid4()
    url = (
        f"https://proj.supabase.co/storage/v1/object/sign/"
        f"{BUCKET}/{me}/./take.wav"
    )
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=me, expected_origin=OURS
    )


def test_a_dot_inside_a_filename_is_still_allowed() -> None:
    """The guard rejects `.` and `..` *segments*, not dots.

    Every real object here has an extension, and a name may carry more than
    one. Rejecting the character rather than the segment would refuse the
    ordinary case, which is how a security fix becomes an outage.
    """
    me = uuid4()
    url = (
        f"https://proj.supabase.co/storage/v1/object/sign/"
        f"{BUCKET}/{me}/my..take.final.v2.wav"
    )
    assert is_owned_storage_url(
        url, bucket=BUCKET, user_id=me, expected_origin=OURS
    )


def test_a_path_that_only_looks_like_a_prefix_is_refused() -> None:
    """`/storage/v1/object/sign/audio-uploads-evil/<id>/` shares a prefix with
    the bucket name and is not the bucket."""
    uid = uuid4()
    url = f"https://proj.supabase.co/storage/v1/object/sign/{BUCKET}-evil/{uid}/x.wav"
    assert not is_owned_storage_url(
        url, bucket=BUCKET, user_id=uid, expected_origin=OURS
    )


def test_an_implicit_and_explicit_default_port_are_the_same_origin() -> None:
    """Otherwise a perfectly legitimate URL is refused for writing `:443`."""
    assert origin_of("https://proj.supabase.co/x") == origin_of(
        "https://proj.supabase.co:443/x"
    )
    assert storage_origin("https://proj.supabase.co") == OURS


def test_a_url_with_no_host_is_refused() -> None:
    assert origin_of("/storage/v1/object/sign/audio-uploads/x/take.wav") is None


def test_a_non_http_scheme_on_our_own_host_is_refused() -> None:
    """The scheme check is load-bearing and a mutation run proved it was not
    covered. `file://proj.supabase.co:443/x` produces the *same* origin string
    as the real thing, so origin alone lets it through — and httpx would be
    handed a scheme it was never meant to fetch."""
    uid = uuid4()
    assert origin_of("file://proj.supabase.co:443/x") == OURS
    assert not is_owned_storage_url(
        f"file://proj.supabase.co:443/storage/v1/object/sign/{BUCKET}/{uid}/x.wav",
        bucket=BUCKET,
        user_id=uid,
        expected_origin=OURS,
    )
