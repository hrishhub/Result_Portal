const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/genai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const gradeWeights = { 'S': 10, 'A': 9, 'B': 8, 'C': 7, 'D': 6, 'E': 5, 'U': 0, 'AB': 0 };

app.post('/api/extract-result', upload.single('resultImage'), async (req, res) => {
    try {
        const { studentName } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Please upload an image.' });
        if (!studentName) return res.status(400).json({ error: 'Please enter a student name to track.' });

        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString('base64'),
                mimeType: req.file.mimetype
            }
        };

        const prompt = `
            You are an advanced academic OCR parsing engine. Your job is to process this End Semester Examinations Result sheet.
            This sheet contains a grid layout containing columns: S.No., Reg. No., Name, followed by dynamic Course Codes as headers.
            
            Instructions:
            1. Find the horizontal header row containing the course codes (e.g., EC301, EEM202, etc.). Keep track of all of them.
            2. Search the rows for a student name matching: "${studentName}" (Allow flexible partial matching and case-insensitive lookups).
            3. Extract that specific student's Registration Number and the corresponding Grade achieved for each unique Course Code column.
            
            Return exclusively a clean, raw JSON string without any markdown backticks, code blocks, or extra text wrapper:
            {
                "success": true,
                "name": "FULL_IDENTIFIED_NAME",
                "regNo": "REGISTRATION_NUMBER",
                "results": [
                    {"courseCode": "CODE_1", "grade": "GRADE"},
                    {"courseCode": "CODE_2", "grade": "GRADE"}
                ]
            }
            
            If the student name cannot be found in the sheet ledger, return exactly:
            { "success": false, "error": "Specified student name was not found in this result sheet." }
        `;

                // Helper: retry transient network errors (connect timeouts) a few times
                async function generateWithRetries(payload, maxAttempts = 3) {
                    let attempt = 0;
                    while (attempt < maxAttempts) {
                        attempt += 1;
                        try {
                            return await ai.models.generateContent(payload);
                        } catch (err) {
                            const causeCode = err && err.cause && err.cause.code ? err.cause.code : null;
                            console.error(`GenAI attempt ${attempt} failed; cause=${causeCode || err.message}`);
                            if (attempt >= maxAttempts) throw err;
                            // wait with exponential backoff before retrying
                            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                        }
                    }
                }

                const response = await generateWithRetries({
                    model: 'gemini-2.5-flash',
                    contents: [prompt, imagePart],
                });

        const responseText = response.text.trim();
        const cleanJsonString = responseText.replace(/^```json\s*|```$/g, '');
        const parsedData = JSON.parse(cleanJsonString);

        if (!parsedData.success) {
            return res.status(404).json({ error: parsedData.error || "Could not parse student records." });
        }

        const processedSubjects = parsedData.results.map(item => {
            const gradeUpper = item.grade.toUpperCase();
            let inferredCredit = 3; 
            if (/[567]$/.test(item.courseCode)) inferredCredit = 1;
            else if (/[123489]$/.test(item.courseCode)) inferredCredit = 4;

            return {
                courseCode: item.courseCode,
                grade: gradeUpper,
                credit: inferredCredit, 
                weight: gradeWeights[gradeUpper] !== undefined ? gradeWeights[gradeUpper] : 0
            };
        });

        res.json({
            name: parsedData.name,
            regNo: parsedData.regNo,
            subjects: processedSubjects
        });

    } catch (error) {
        console.error("Gemini Multi-branch Parse Error:", error);
        res.status(500).json({ error: 'System processing timed out or failed to extract image content cleanly.' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Dynamic Grading Server running on port ${PORT}`));
