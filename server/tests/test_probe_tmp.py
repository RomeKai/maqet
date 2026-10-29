"""Scratch probe of the installed ezdxf dimension API (not part of the suite)."""

import ezdxf


def test_probe_aligned_dim_api(tmp_path):
    print("ezdxf version:", ezdxf.__version__)
    doc = ezdxf.new("R2018", setup=True)
    msp = doc.modelspace()
    dim = msp.add_aligned_dim(p1=(0, 0), p2=(5, 0), distance=0.5)
    print("wrapper:", type(dim))
    dim.render()
    ent = dim.dimension
    print("entity type:", ent.dxftype(), "layer:", ent.dxf.layer)
    print("dir attrs:", [a for a in dir(dim) if "meas" in a.lower()])
    print("measurement prop:", dim.measurement if hasattr(dim, "measurement") else "N/A")
    print("dxf.text:", repr(ent.dxf.text))
    print("msp types:", sorted({e.dxftype() for e in msp}))
    print("defpoints:", ent.dxf.defpoint, ent.dxf.defpoint2, ent.dxf.defpoint3 if hasattr(ent.dxf, "defpoint3") else None)
    # set layer + check audit
    ent.dxf.layer = "A-ANNO-DIMS"
    out = tmp_path / "probe.dxf"
    doc.saveas(out)
    doc2 = ezdxf.readfile(out)
    dims = [e for e in doc2.modelspace() if e.dxftype() == "DIMENSION"]
    print("reopened DIMENSION count:", len(dims))
    print("audit errors:", doc2.audit().errors)
