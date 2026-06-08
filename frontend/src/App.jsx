import React, { useState, useRef } from 'react';

const GRADE_WEIGHTS = { 'S': 10, 'A': 9, 'B': 8, 'C': 7, 'D': 6, 'E': 5, 'U': 0, 'I': 0 };
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App() {
  const [name, setName] = useState('');
  const [regNo, setRegNo] = useState('');
  const [searchName, setSearchName] = useState('');
  const [semester, setSemester] = useState('');
  const [image, setImage] = useState(null);
  const [subjects, setSubjects] = useState([{ courseCode: '', grade: '', credit: 3 }]);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [showPleaseWait, setShowPleaseWait] = useState(false);
  const [showManualPrompt, setShowManualPrompt] = useState(false);
  const [calculation, setCalculation] = useState(null);
  const [prevSemesters, setPrevSemesters] = useState([{ sem: 'Sem 1', credits: '', sgpa: '' }]);
  const [includeCurrentInCgpa, setIncludeCurrentInCgpa] = useState(true);
  const [manualCurrentCredits, setManualCurrentCredits] = useState('');
  const [manualCurrentSgpa, setManualCurrentSgpa] = useState('');
  const [cgpaResult, setCgpaResult] = useState(null);
  const [showCgpaCalculator, setShowCgpaCalculator] = useState(false);
  const fetchControllerRef = useRef(null);

  const handleAddRow = () => setSubjects([...subjects, { courseCode: '', grade: '', credit: 3 }]);
  const handleRemoveRow = (idx) => setSubjects(subjects.filter((_, i) => i !== idx));
  const handleFieldChange = (idx, field, val) => {
    const nextSub = [...subjects];
    nextSub[idx][field] = val;
    setSubjects(nextSub);
  };

  const addPrevSem = () => setPrevSemesters([...prevSemesters, { sem: `Sem ${prevSemesters.length + 1}`, credits: '', sgpa: '' }]);
  const removePrevSem = (i) => setPrevSemesters(prevSemesters.filter((_, idx) => idx !== i));
  const updatePrevSem = (i, field, val) => {
    const next = [...prevSemesters];
    next[i][field] = val;
    setPrevSemesters(next);
  };

  // Compute CGPA as a simple average of semester SGPAs (unweighted)
  const computeSGPA = () => {
    if (!subjects || subjects.length === 0) {
      alert('Please add at least one course to compute SGPA');
      return;
    }

    const breakDown = subjects
      .map((sub) => {
        const code = (sub.courseCode || sub.code || '').trim();
        const grade = (sub.grade || '').toUpperCase().trim();
        const credit = parseFloat(sub.credit);

        if (!code || !grade || isNaN(credit) || credit <= 0) {
          return null;
        }

        const weight = GRADE_WEIGHTS[grade];
        if (weight === undefined) {
          return null;
        }

        const subTotal = weight * credit;
        return { code, grade, credit, weight, subTotal };
      })
      .filter(Boolean);

    if (breakDown.length === 0) {
      alert('Please enter valid course code, grade, and credits for at least one subject');
      return;
    }

    const totalCredits = breakDown.reduce((sum, item) => sum + item.credit, 0);
    const totalScore = breakDown.reduce((sum, item) => sum + item.subTotal, 0);

    if (totalCredits <= 0) {
      alert('Total credits must be greater than zero');
      return;
    }

    setCalculation({
      registeredCredits: totalCredits,
      totalScore,
      finalSgpa: (totalScore / totalCredits).toFixed(2),
      breakDown,
    });
  };

  const computeCGPA = () => {
    let sumSgpa = 0;
    let count = 0;

    for (const s of prevSemesters) {
      const g = parseFloat(s.sgpa);
      if (!isNaN(g)) {
        sumSgpa += g;
        count += 1;
      }
    }

    if (includeCurrentInCgpa) {
      if (calculation) {
        const cSgpa = parseFloat(calculation.finalSgpa);
        if (!isNaN(cSgpa)) {
          sumSgpa += cSgpa;
          count += 1;
        }
      } else {
        const cSgpa = parseFloat(manualCurrentSgpa);
        if (!isNaN(cSgpa)) {
          sumSgpa += cSgpa;
          count += 1;
        }
      }
    }

    if (count === 0) {
      alert('Please provide at least one semester SGPA (previous or current) to compute CGPA');
      return;
    }

    const cgpa = (sumSgpa / count).toFixed(2);
    setCgpaResult({ cgpa, semesters: count });
  };

  const handleUploadAndScan = async (e) => {
    e.preventDefault();
    if (!image || !searchName.trim()) {
      alert("Please enter the student's name and upload a visible grade ledger image.");
      return;
    }

    setLoading(true);
    setCountdown(5);
    setShowPleaseWait(false);
    setShowManualPrompt(false);

    // start a visible 5-second countdown
    const timerPromise = new Promise((resolve) => {
      let t = 5;
      setCountdown(t);
      const id = setInterval(() => {
        t -= 1;
        setCountdown(t);
        if (t <= 0) {
          clearInterval(id);
          setShowPleaseWait(true); // after countdown ends, show 'Please wait' until fetch completes
          resolve();
        }
      }, 1000);
    });

    const fd = new FormData();
    fd.append('resultImage', image);
    fd.append('studentName', searchName);

    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const signal = controller.signal;

    // after 12 seconds, offer user to switch to manual entry if fetch still running
    const manualTimeoutId = setTimeout(() => {
      setShowManualPrompt(true);
    }, 12000);

    const fetchPromise = fetch(`${API_BASE_URL}/api/extract-result`, { method: 'POST', body: fd, signal })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        return { res, data };
      })
      .catch(err => {
        // If aborted by user, return an object indicating abort so caller can handle gracefully
        if (err.name === 'AbortError') return { aborted: true };
        throw err;
      });

    try {
      // wait for initial 5s countdown first
      await timerPromise;

      // after countdown, wait for fetch to finish (or abort) — user may abort via manual prompt
      const fetchResult = await fetchPromise;

      // clear manual prompt timeout
      clearTimeout(manualTimeoutId);

      if (!fetchResult) throw new Error('No response from server');
      if (fetchResult.aborted) {
        // user chose manual entry (fetch aborted)
        setLoading(false);
        setCountdown(0);
        setShowPleaseWait(false);
        setShowManualPrompt(false);
        return;
      }

      const { res, data } = fetchResult;
      if (!res) throw new Error('No response from server');
      if (!res.ok) throw new Error(data?.error || 'Server processing error');

      setName(data.name);
      setRegNo(data.regNo);
      setSubjects(data.subjects);
      setCalculation(null);
    } catch (err) {
      // ensure countdown completed visually before showing error
      try { await timerPromise; } catch (_) {}

      // If fetch was aborted by user via manual prompt, we already handled above.
      if (err && err.name === 'AbortError') {
        // handled by abort flow
      } else {
        alert(err.message || 'Failed to extract result');
      }
    } finally {
      clearTimeout(manualTimeoutId);
      setLoading(false);
      setCountdown(0);
      setShowPleaseWait(false);
      setShowManualPrompt(false);
      fetchControllerRef.current = null;
    }
  };
  function generateRecommendations(breakDown) {
    return breakDown.map(item => {
      const grade = (item.grade || '').toUpperCase();
      const code = item.code || 'Course';
      // Infer department or topic from code prefix (letters)
      const prefix = (code.match(/[A-Za-z]+/) || ['General'])[0];
      let level = 'Moderate';
      let advice = '';

      if (grade === 'S' || grade === 'A') {
        level = 'Strong';
        advice = `Excellent performance in ${code}. Keep practising advanced problems and maintain consistency.`;
      } else if (grade === 'B') {
        level = 'Good';
        advice = `Solid understanding of ${prefix} fundamentals. Focus on problem-solving and previous-year questions for ${code}.`;
      } else if (grade === 'C' || grade === 'D') {
        level = 'Needs Work';
        advice = `Review core topics of ${prefix} and re-do lecture examples for ${code}. Try weekly practice and short concept notes.`;
      } else {
        level = 'Action Required';
        advice = `Please revisit basics of ${prefix}. Consider tutoring, topic-wise revision, and solving simpler problems before advancing.`;
      }

      return { courseCode: code, grade, level, advice };
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10 text-black">
      <div className="max-w-3xl mx-auto">
        {loading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white/95 rounded-lg p-6 w-80 text-center shadow-lg">
              {showManualPrompt ? (
                <div>
                  <div className="text-lg font-semibold text-slate-800">Auto-extraction is taking longer than expected.</div>
                  <div className="mt-2 text-sm text-slate-600">You can switch to manual entry of subjects and grades.</div>
                  <div className="mt-4 flex justify-center gap-3">
                    <button
                      onClick={() => {
                        try { fetchControllerRef.current?.abort(); } catch (_) {}
                        setLoading(false);
                        setCountdown(0);
                        setShowManualPrompt(false);
                        setShowPleaseWait(false);
                      }}
                      className="bg-rose-500 text-white px-4 py-2 rounded"
                    >
                      Switch to Manual Entry
                    </button>
                    <button
                      onClick={() => setShowManualPrompt(false)}
                      className="border border-slate-300 px-4 py-2 rounded"
                    >
                      Continue Waiting
                    </button>
                  </div>
                </div>
              ) : countdown > 0 ? (
                <div>
                  <div className="text-4xl font-extrabold text-indigo-700">{countdown}</div>
                  <div className="mt-2 text-sm text-slate-700">Extracting text... Please wait</div>
                </div>
              ) : (
                <div>
                  <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto" />
                  <div className="mt-3 font-medium text-slate-800">Please wait — extracting results</div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Official-like header */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="w-16 h-16 bg-white border rounded-full flex items-center justify-center shadow-sm">
            {/* emblem placeholder */}
            <div className="text-indigo-600 font-extrabold">U</div>
          </div>
          <div className="text-center">
            <h1 className="text-xl md:text-2xl font-semibold text-slate-900">NIT Nagaland Result Portal</h1>
            <p className="text-sm text-slate-600">Official Result Portal — Semester Grade Summary</p>
          </div>
        </div>

        {/* Central white card like exam result site */}
        <div className="bg-white border border-slate-200 rounded-md shadow-md overflow-hidden">
          <div className="p-6">
            <form onSubmit={handleUploadAndScan} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-600 font-medium">Student Name</label>
                  <input value={searchName} onChange={e => setSearchName(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 text-slate-900" placeholder="As in result sheet" />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 font-medium">Upload Result Image</label>
                  <input type="file" accept="image/*" onChange={e => setImage(e.target.files[0])} className="mt-1 block w-full text-sm text-slate-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 font-medium">Semester</label>
                  <input value={semester} onChange={e => setSemester(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 text-slate-900" placeholder="e.g. Semester 4" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button type="submit" disabled={loading} className="bg-indigo-700 hover:bg-indigo-600 text-white px-5 py-2 rounded text-sm font-medium shadow">
                  {loading ? 'Scanning...' : 'Scan & Extract'}
                </button>
                <button type="button" onClick={computeSGPA} className="border border-slate-300 text-slate-700 px-4 py-2 rounded text-sm">Compute SGPA</button>
                <button type="button" onClick={() => setShowCgpaCalculator((prev) => !prev)} className="border border-indigo-300 text-indigo-700 px-4 py-2 rounded text-sm">
                  {showCgpaCalculator ? 'Hide CGPA Calculator' : 'Show CGPA Calculator'}
                </button>
                <div className="ml-auto text-sm text-slate-500">Tip: you can also edit courses below</div>
              </div>
            </form>

            {/* student quick fields */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" className="border border-slate-200 rounded px-3 py-2 text-slate-900" />
              <input value={regNo} onChange={e => setRegNo(e.target.value)} placeholder="Registration No" className="border border-slate-200 rounded px-3 py-2 text-slate-900" />
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-medium text-slate-700 mb-3">Courses</h3>
              <div className="space-y-2">
                {subjects.map((sub, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input className="col-span-6 border border-slate-200 rounded px-2 py-1 text-sm text-slate-900" placeholder="Course Code" value={sub.courseCode} onChange={e => handleFieldChange(idx, 'courseCode', e.target.value)} />
                    <input className="col-span-2 border border-slate-200 rounded px-2 py-1 text-sm text-center text-slate-900" placeholder="Grade" value={sub.grade} onChange={e => handleFieldChange(idx, 'grade', e.target.value)} />
                    <input type="number" className="col-span-2 border border-slate-200 rounded px-2 py-1 text-sm text-center text-slate-900" placeholder="Cr" value={sub.credit} onChange={e => handleFieldChange(idx, 'credit', e.target.value)} />
                    <button onClick={() => handleRemoveRow(idx)} className="col-span-2 text-rose-500">Remove</button>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <button onClick={handleAddRow} className="text-sm text-indigo-700">+ Add Course</button>
              </div>
            </div>

              {/* CGPA calculator block */}
              {showCgpaCalculator && (
              <div className="p-4 border-t border-slate-100 bg-white mt-4">
                <h4 className="text-sm font-medium text-slate-700 mb-2">CGPA Calculator (Previous Semesters)</h4>
                <div className="space-y-2">
                  {prevSemesters.map((ps, i) => (
                    <div key={i} className="flex gap-2 items-center">
                          <input value={ps.sem} onChange={e => updatePrevSem(i, 'sem', e.target.value)} className="w-24 border border-slate-200 rounded px-2 py-1 text-sm text-black" />
                          <input value={ps.credits} onChange={e => updatePrevSem(i, 'credits', e.target.value)} placeholder="Credits" className="w-28 border border-slate-200 rounded px-2 py-1 text-sm text-black" />
                          <input value={ps.sgpa} onChange={e => updatePrevSem(i, 'sgpa', e.target.value)} placeholder="SGPA" className="w-28 border border-slate-200 rounded px-2 py-1 text-sm text-black" />
                      <button onClick={() => removePrevSem(i)} className="text-rose-500 text-sm">Remove</button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={addPrevSem} className="text-sm text-indigo-700">+ Add Semester</button>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeCurrentInCgpa} onChange={e => setIncludeCurrentInCgpa(e.target.checked)} /> Include current semester</label>
                  {!calculation && includeCurrentInCgpa && (
                    <>
                        <input value={manualCurrentCredits} onChange={e => setManualCurrentCredits(e.target.value)} placeholder="Current Credits" className="w-28 border border-slate-200 rounded px-2 py-1 text-sm text-black" />
                        <input value={manualCurrentSgpa} onChange={e => setManualCurrentSgpa(e.target.value)} placeholder="Current SGPA" className="w-28 border border-slate-200 rounded px-2 py-1 text-sm text-black" />
                    </>
                  )}
                </div>
                <div className="mt-3">
                  <button onClick={computeCGPA} className="bg-indigo-600 text-white px-4 py-2 rounded text-sm">Calculate CGPA</button>
                  {cgpaResult && (
                    <div className="inline-block ml-4 text-sm">CGPA: <span className="font-bold text-indigo-700">{cgpaResult.cgpa}</span> (Semesters: {cgpaResult.semesters})</div>
                  )}
                </div>
              </div>
              )}
          </div>

          {/* result area */}
          {calculation && (
            <div className="border-t border-slate-100 p-6 bg-slate-50">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-600">Name</div>
                  <div className="text-lg font-semibold text-slate-900">{name || 'Student'}</div>
                  <div className="text-sm text-slate-600 mt-1">Semester: {semester || 'N/A'}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-600">Marks (SGPA)</div>
                  <div className="text-3xl font-extrabold text-indigo-700">{calculation.finalSgpa}</div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm bg-white">
                  <thead>
                    <tr className="text-left text-slate-600 text-xs">
                      <th className="py-2">Subject Code</th>
                      <th className="py-2 text-center">Grade</th>
                      <th className="py-2 text-center">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.breakDown.map((it, k) => (
                      <tr key={k} className="border-t border-slate-100 text-slate-700">
                        <td className="py-2">{it.code}</td>
                        <td className="py-2 text-center font-semibold">{it.grade}</td>
                        <td className="py-2 text-center">{it.credit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex gap-3">
                <button onClick={() => window.print()} className="bg-indigo-700 text-white px-4 py-2 rounded">Print / Download</button>
                <button onClick={() => navigator.clipboard?.writeText(JSON.stringify({ name, regNo, calculation }))} className="border border-slate-300 px-4 py-2 rounded">Copy JSON</button>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-6 text-center text-sm text-slate-500 py-4">
          Made with <span aria-hidden="true">❤</span> by Fermetrix Lab
        </footer>
      </div>
    </div>
  );
}