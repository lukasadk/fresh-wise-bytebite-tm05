def structured_recovery_prompt(base_prompt: str, max_items: int) -> str:
    """Add one deterministic recovery instruction after malformed generation."""

    return (
        f"{base_prompt.rstrip()}\n\n"
        "RECOVERY ATTEMPT: The previous response could not be parsed as the required JSON "
        "object. Start the visual inventory again from the image; do not quote or repair the "
        "previous text. Return one compact JSON object only, with an `items` array and no "
        f"more than {max_items} item objects. Close every string, array and object. Do not "
        "repeat item objects or packaging evidence."
    )
