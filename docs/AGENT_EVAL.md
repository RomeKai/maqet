# Agent multi-turn eval

Scripted fake model replaying real and common call sequences through the real loop, executor and
addressing code on the `croquis_3x8_door_window` sample. Source: `server/tests/test_agent_multiturn_eval.py`.
Regenerated on every pytest run.

Result: 32/32 checks pass.

| Scenario | Check / phrasing | Result |
|---|---|---|
| add room, then window | add a 3x4 room | pass |
| add room, then window | add a window to the new room | pass |
| add room, then window | window is on the new room | pass |
| guessed wall numbers | wall 9 | pass |
| guessed wall numbers | wall 10 | pass |
| guessed wall numbers | wall 8 | pass |
| widen the door | make the door bigger | pass |
| room on the window wall | wall with a window | pass |
| room on the window wall | window is kept | pass |
| room on the window wall | door goes in a free span | pass |
| variant switch | A keeps Bedroom 2 | pass |
| variant switch | B keeps Study | pass |
| variant switch | window only in A | pass |
| variant switch | chats are separate | pass |
| undo, redo | undo restores the house | pass |
| undo, redo | redo gives the room back | pass |
| resize the new room | make the new room 3 by 5 | pass |
| split a room | split the big room in two | pass |
| split a room | areas are about half | pass |
| phrasings on the new room | add a window to the new room (north) | pass |
| phrasings on the new room | put a window on the east side of the new room | pass |
| phrasings on the new room | a window on the north wall of the new bedroom | pass |
| phrasings on the new room | window on the new room's outside wall | pass |
| phrasings on the new room | make the new room 3 x 5 | pass |
| phrasings on the new room | make the last room bigger | pass |
| phrasings on the new room | rename the new room to Study | pass |
| phrasings on the new room | split the new room in two | pass |
| phrasings on the new room | move the north wall of the new room 0.5 m | pass |
| phrasings on the new room | make the wall facing the garden of the new room 3 m | pass |
| phrasings on the new room | door on the new room's north wall | pass |
| refusals | window on the shared wall | pass |
| refusals | south side of the new room is the shared wall | pass |
