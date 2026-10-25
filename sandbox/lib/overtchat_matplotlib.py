"""Matplotlib backend for sandbox runs: show() saves figures as output files.

Selected with MPLBACKEND=module://overtchat_matplotlib, so ``plt.show()``
produces images instead of opening a window. Figures still open when the
program ends are saved too.
"""

import atexit
import os

from matplotlib.backend_bases import FigureManagerBase, _Backend
from matplotlib.backends.backend_agg import FigureCanvasAgg


def save_open_figures() -> None:
    import matplotlib.pyplot as plt

    directory = os.environ.get("OVERTCHAT_OUTPUT_DIR")
    if not directory:
        return
    for number in plt.get_fignums():
        figure = plt.figure(number)
        index = 1
        while os.path.exists(os.path.join(directory, f"figure-{index}.png")):
            index += 1
        figure.savefig(
            os.path.join(directory, f"figure-{index}.png"),
            dpi=150,
            bbox_inches="tight",
        )
        plt.close(figure)


# Matplotlib registers its own exit hook, which closes every figure, before it
# loads this backend; exit hooks run last-registered first, so this one wins.
atexit.register(save_open_figures)


@_Backend.export
class _OvertChatBackend(_Backend):
    FigureCanvas = FigureCanvasAgg
    FigureManager = FigureManagerBase

    @staticmethod
    def mainloop() -> None:
        save_open_figures()

    @classmethod
    def show(cls, *args, **kwargs) -> None:
        save_open_figures()
