"""Pinned HTTPS uses the validated address while checking the original hostname."""

from unittest.mock import Mock, patch

import pytest

from backend.app.main import PinnedHTTPSConnection


@pytest.mark.parametrize("tls_fails", [False, True])
def test_pinned_tls_socket_is_verified_and_closed_on_failure(tls_fails: bool) -> None:
    raw_socket, context = Mock(), Mock()
    if tls_fails:
        context.wrap_socket.side_effect = OSError("TLS handshake failed")
    with (
        patch("backend.app.main.ssl.create_default_context", return_value=context),
        patch("backend.app.main.socket.create_connection", return_value=raw_socket) as connect,
    ):
        connection = PinnedHTTPSConnection("93.184.216.34", "catalogue.example", 443, 6)
        if tls_fails:
            with pytest.raises(OSError, match="TLS handshake"):
                connection.connect()
            raw_socket.close.assert_called_once()
        else:
            connection.connect()
            assert connection.sock is context.wrap_socket.return_value
            raw_socket.close.assert_not_called()
        connect.assert_called_once_with(("93.184.216.34", 443), 6)
        context.wrap_socket.assert_called_once_with(raw_socket, server_hostname="catalogue.example")
