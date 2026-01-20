#!/usr/bin/env python3
"""Verification script for RoundRobinRotationStrategy."""

from core.rotation import RoundRobinRotationStrategy

if __name__ == "__main__":
    strategy = RoundRobinRotationStrategy()
    mode = strategy.get_mode()
    print(f"Strategy: {mode}")

    # Verify mode is correct
    assert mode.value == "round_robin", f"Expected 'round_robin', got {mode.value}"

    # Verify initial index
    assert strategy.get_current_index() == 0, "Initial index should be 0"

    # Test index methods
    strategy.set_index(2)
    assert strategy.get_current_index() == 2, "Index should be 2"

    strategy.reset_index()
    assert strategy.get_current_index() == 0, "Index should be reset to 0"

    print("✓ All verification checks passed!")
