# Third-party software in the OvertChat sandbox image

The OvertChat sources in this directory (`server.py`, `runner.c`, `lib/`,
`skills/`) are MIT-licensed like the rest of the repository. The image also
contains the following separately licensed programs and libraries, which are
installed unmodified and run as separate programs or imported by user code.
Debian packages carry their full copyright and license texts under
`/usr/share/doc/<package>/copyright`; Python packages carry theirs in their
`*.dist-info` directories under `/opt/overtchat/venv`.

| Component | Tier | License |
| --- | --- | --- |
| Python (official Docker image) | slim, full | PSF-2.0 |
| libseccomp | slim, full | LGPL-2.1-only |
| pandoc | slim, full | GPL-2.0-or-later |
| poppler-utils | slim, full | GPL-2.0-only or GPL-3.0-only |
| numpy, pandas | slim, full | BSD-3-Clause |
| matplotlib | slim, full | Matplotlib License (PSF-based) |
| Pillow | slim, full | MIT-CMU |
| openpyxl, python-docx, python-pptx, beautifulsoup4, PyYAML, tabulate | slim, full | MIT |
| XlsxWriter, lxml, pypdf, ReportLab, Markdown | slim, full | BSD-style |
| pdfplumber | slim, full | MIT |
| LibreOffice | full | MPL-2.0 |
| Tesseract OCR and its English data | full | Apache-2.0 |
| ffmpeg (Debian build) | full | GPL-2.0-or-later |
| Liberation, DejaVu and Noto CJK fonts | full | OFL-1.1 and permissive font licenses |
| SciPy, scikit-learn, statsmodels | full | BSD-3-Clause |
| seaborn | full | BSD-3-Clause |
| OpenCV (opencv-python-headless) | full | Apache-2.0 (bundled components under their own licenses) |
| pytesseract, pdf2image | full | Apache-2.0 / MIT |

Source code for the GPL and LGPL programs is available from Debian
(`apt-get source <package>`) for the exact versions in the image, and from
the projects' upstream repositories.
