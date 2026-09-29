from __future__ import annotations

import argparse
import sys

from retail_data_platform.personal_auth.client import LoginRequired, PersonalClient
from retail_data_platform.personal_auth.login import login


def main() -> int:
    parser = argparse.ArgumentParser(description="Personal API sessions; no automatic renewal")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Open the provider's personal login page")
    commands.add_parser("status", help="Check session validity without displaying a token")
    commands.add_parser("logout", help="Delete this local session from the OS credential vault")
    commands.add_parser("token", help="Explicitly print the access token, for example for Swagger")
    get = commands.add_parser("get", help="Read a /v1/ path with the stored personal session")
    get.add_argument("path", help="Relative API path, optionally with URL query parameters")
    args = parser.parse_args()
    try:
        with PersonalClient() as client:
            if args.command == "login":
                login(client)
                print("Personal session saved in the OS vault (maximum 24 hours).")
            elif args.command == "logout":
                client.logout()
                print("Local session deleted.")
            elif args.command == "status":
                client.access_token()
                print("Personal session valid.")
            elif args.command == "token":
                print(client.access_token())
            elif args.command == "get":
                print(client.get(args.path).text)
    except LoginRequired as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Login cancelled.", file=sys.stderr)
        return 2
    except Exception:
        # Never echo provider responses, vault errors, HTTP URLs or credentials.
        print(
            "Authentication or request failed. Check configuration, provider and OS vault.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
