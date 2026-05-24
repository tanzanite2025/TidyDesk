package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "image/gif"
)

type assetSourceRef struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type outputJob struct {
	ID         string `json:"id"`
	PresetID   string `json:"presetId"`
	Label      string `json:"label"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Fit        string `json:"fit"`
	Format     string `json:"format"`
	Quality    int    `json:"quality,omitempty"`
	Sizes      []int  `json:"sizes,omitempty"`
	Background string `json:"background,omitempty"`
	FileName   string `json:"fileName,omitempty"`
}

type processRequest struct {
	RequestID string         `json:"requestId"`
	Input     assetSourceRef `json:"input"`
	OutputDir string         `json:"outputDir,omitempty"`
	Overwrite bool           `json:"overwrite,omitempty"`
	Jobs      []outputJob    `json:"jobs"`
}

type processFile struct {
	JobID    string `json:"jobId"`
	PresetID string `json:"presetId"`
	Label    string `json:"label"`
	Path     string `json:"path"`
	FileName string `json:"fileName"`
	Format   string `json:"format"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Bytes    int64  `json:"bytes"`
}

type processError struct {
	JobID   string `json:"jobId,omitempty"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type processResponse struct {
	RequestID  string         `json:"requestId"`
	OK         bool           `json:"ok"`
	Files      []processFile  `json:"files"`
	Errors     []processError `json:"errors"`
	DurationMS int64          `json:"durationMs"`
}

var unsafeNamePattern = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func main() {
	requestPath := flag.String("request", "", "JSON request file. Defaults to stdin.")
	flag.Parse()

	started := time.Now()
	req, err := readRequest(*requestPath)
	if err != nil {
		writeFatal("", "bad-request", err)
		os.Exit(2)
	}

	resp := run(req)
	resp.DurationMS = time.Since(started).Milliseconds()
	resp.OK = len(resp.Errors) == 0

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(resp); err != nil {
		fmt.Fprintf(os.Stderr, "failed to encode response: %v\n", err)
		os.Exit(2)
	}

	if !resp.OK {
		os.Exit(1)
	}
}

func readRequest(requestPath string) (processRequest, error) {
	var reader io.Reader = os.Stdin
	var file *os.File
	if requestPath != "" {
		opened, err := os.Open(requestPath)
		if err != nil {
			return processRequest{}, err
		}
		file = opened
		reader = opened
	}
	if file != nil {
		defer file.Close()
	}

	data, err := io.ReadAll(reader)
	if err != nil {
		return processRequest{}, err
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})

	var req processRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return processRequest{}, err
	}
	return req, nil
}

func writeFatal(requestID string, code string, err error) {
	resp := processResponse{
		RequestID: requestID,
		OK:        false,
		Files:     []processFile{},
		Errors: []processError{
			{Code: code, Message: err.Error()},
		},
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(resp)
}

func run(req processRequest) processResponse {
	resp := processResponse{
		RequestID: req.RequestID,
		Files:     []processFile{},
		Errors:    []processError{},
	}

	if req.Input.Path == "" {
		resp.Errors = append(resp.Errors, processError{Code: "missing-input", Message: "input.path is required"})
		return resp
	}
	if len(req.Jobs) == 0 {
		resp.Errors = append(resp.Errors, processError{Code: "missing-jobs", Message: "at least one output job is required"})
		return resp
	}

	source, err := decodeImage(req.Input.Path)
	if err != nil {
		resp.Errors = append(resp.Errors, processError{Code: "decode-failed", Message: err.Error()})
		return resp
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = filepath.Join(filepath.Dir(req.Input.Path), "tidydesk-assets")
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		resp.Errors = append(resp.Errors, processError{Code: "output-dir-failed", Message: err.Error()})
		return resp
	}

	for _, job := range req.Jobs {
		file, jobErr := processJob(source, req.Input.Path, outputDir, job, req.Overwrite)
		if jobErr != nil {
			resp.Errors = append(resp.Errors, processError{JobID: job.ID, Code: jobErr.code, Message: jobErr.err.Error()})
			continue
		}
		resp.Files = append(resp.Files, file)
	}

	return resp
}

type codedError struct {
	code string
	err  error
}

func processJob(source image.Image, inputPath string, outputDir string, job outputJob, overwrite bool) (processFile, *codedError) {
	format := normalizeFormat(job.Format)
	if format == "" {
		return processFile{}, &codedError{code: "bad-format", err: fmt.Errorf("unsupported format %q", job.Format)}
	}
	if format == "webp" {
		return processFile{}, &codedError{code: "unsupported-format", err: errors.New("webp encoder is not bundled in this isolated worker yet")}
	}
	if job.Width <= 0 || job.Height <= 0 {
		return processFile{}, &codedError{code: "bad-size", err: errors.New("width and height must be greater than zero")}
	}

	fileName := job.FileName
	if fileName == "" {
		fileName = defaultFileName(inputPath, job, format)
	}
	fileName = sanitizeFileName(fileName)
	if filepath.Ext(fileName) == "" {
		fileName = fileName + "." + extensionForFormat(format)
	}

	outputPath := filepath.Join(outputDir, fileName)
	if !overwrite {
		outputPath = nextAvailablePath(outputPath)
	}

	if format == "ico" {
		if err := writeICO(outputPath, source, job); err != nil {
			return processFile{}, &codedError{code: "encode-failed", err: err}
		}
	} else {
		rendered, err := renderImage(source, job)
		if err != nil {
			return processFile{}, &codedError{code: "render-failed", err: err}
		}
		if err := writeRaster(outputPath, rendered, format, job.Quality); err != nil {
			return processFile{}, &codedError{code: "encode-failed", err: err}
		}
	}

	stat, err := os.Stat(outputPath)
	if err != nil {
		return processFile{}, &codedError{code: "stat-failed", err: err}
	}

	return processFile{
		JobID:    job.ID,
		PresetID: job.PresetID,
		Label:    fallback(job.Label, job.ID),
		Path:     outputPath,
		FileName: filepath.Base(outputPath),
		Format:   format,
		Width:    job.Width,
		Height:   job.Height,
		Bytes:    stat.Size(),
	}, nil
}

func decodeImage(path string) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		return nil, err
	}
	return img, nil
}

func renderImage(source image.Image, job outputJob) (*image.NRGBA, error) {
	bg, err := parseHexColor(job.Background)
	if err != nil {
		return nil, err
	}

	dst := image.NewNRGBA(image.Rect(0, 0, job.Width, job.Height))
	if bg.A > 0 {
		draw.Draw(dst, dst.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	}

	fit := job.Fit
	if fit == "" {
		fit = "cover"
	}

	srcBounds := source.Bounds()
	srcWidth := srcBounds.Dx()
	srcHeight := srcBounds.Dy()
	if srcWidth <= 0 || srcHeight <= 0 {
		return nil, errors.New("source image has invalid bounds")
	}

	if fit == "stretch" {
		resized := resizeBilinear(source, job.Width, job.Height)
		draw.Draw(dst, dst.Bounds(), resized, image.Point{}, draw.Over)
		return dst, nil
	}

	xScale := float64(job.Width) / float64(srcWidth)
	yScale := float64(job.Height) / float64(srcHeight)
	scale := math.Max(xScale, yScale)
	if fit == "contain" {
		scale = math.Min(xScale, yScale)
	} else if fit != "cover" {
		return nil, fmt.Errorf("unsupported fit mode %q", fit)
	}

	nextWidth := maxInt(1, int(math.Round(float64(srcWidth)*scale)))
	nextHeight := maxInt(1, int(math.Round(float64(srcHeight)*scale)))
	resized := resizeBilinear(source, nextWidth, nextHeight)
	offset := image.Pt((job.Width-nextWidth)/2, (job.Height-nextHeight)/2)
	draw.Draw(dst, image.Rectangle{Min: offset, Max: offset.Add(resized.Bounds().Size())}, resized, image.Point{}, draw.Over)
	return dst, nil
}

func resizeBilinear(source image.Image, width int, height int) *image.NRGBA {
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	srcBounds := source.Bounds()
	srcWidth := srcBounds.Dx()
	srcHeight := srcBounds.Dy()

	if width == srcWidth && height == srcHeight {
		draw.Draw(dst, dst.Bounds(), source, srcBounds.Min, draw.Src)
		return dst
	}

	for y := 0; y < height; y++ {
		srcY := (float64(y)+0.5)*float64(srcHeight)/float64(height) - 0.5
		y0 := clampInt(int(math.Floor(srcY)), 0, srcHeight-1)
		y1 := clampInt(y0+1, 0, srcHeight-1)
		wy := srcY - float64(y0)

		for x := 0; x < width; x++ {
			srcX := (float64(x)+0.5)*float64(srcWidth)/float64(width) - 0.5
			x0 := clampInt(int(math.Floor(srcX)), 0, srcWidth-1)
			x1 := clampInt(x0+1, 0, srcWidth-1)
			wx := srcX - float64(x0)

			c00 := color.NRGBAModel.Convert(source.At(srcBounds.Min.X+x0, srcBounds.Min.Y+y0)).(color.NRGBA)
			c10 := color.NRGBAModel.Convert(source.At(srcBounds.Min.X+x1, srcBounds.Min.Y+y0)).(color.NRGBA)
			c01 := color.NRGBAModel.Convert(source.At(srcBounds.Min.X+x0, srcBounds.Min.Y+y1)).(color.NRGBA)
			c11 := color.NRGBAModel.Convert(source.At(srcBounds.Min.X+x1, srcBounds.Min.Y+y1)).(color.NRGBA)

			dst.SetNRGBA(x, y, color.NRGBA{
				R: interpolateChannel(c00.R, c10.R, c01.R, c11.R, wx, wy),
				G: interpolateChannel(c00.G, c10.G, c01.G, c11.G, wx, wy),
				B: interpolateChannel(c00.B, c10.B, c01.B, c11.B, wx, wy),
				A: interpolateChannel(c00.A, c10.A, c01.A, c11.A, wx, wy),
			})
		}
	}

	return dst
}

func interpolateChannel(c00 byte, c10 byte, c01 byte, c11 byte, wx float64, wy float64) byte {
	top := float64(c00)*(1-wx) + float64(c10)*wx
	bottom := float64(c01)*(1-wx) + float64(c11)*wx
	value := top*(1-wy) + bottom*wy
	return byte(clampInt(int(math.Round(value)), 0, 255))
}

func writeRaster(path string, img image.Image, format string, quality int) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	switch format {
	case "png":
		return png.Encode(file, img)
	case "jpg", "jpeg":
		if quality <= 0 {
			quality = 88
		}
		return jpeg.Encode(file, img, &jpeg.Options{Quality: clampInt(quality, 1, 100)})
	default:
		return fmt.Errorf("unsupported raster format %q", format)
	}
}

func writeICO(path string, source image.Image, job outputJob) error {
	sizes := job.Sizes
	if len(sizes) == 0 {
		sizes = []int{job.Width}
	}

	pngEntries := make([][]byte, 0, len(sizes))
	for _, size := range sizes {
		if size <= 0 || size > 256 {
			return fmt.Errorf("ico size %d must be between 1 and 256", size)
		}
		entryJob := job
		entryJob.Width = size
		entryJob.Height = size
		entryJob.Fit = fallback(entryJob.Fit, "cover")

		rendered, err := renderImage(source, entryJob)
		if err != nil {
			return err
		}

		var buf bytes.Buffer
		if err := png.Encode(&buf, rendered); err != nil {
			return err
		}
		pngEntries = append(pngEntries, buf.Bytes())
	}

	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writeUint16(file, 0)
	writeUint16(file, 1)
	writeUint16(file, uint16(len(pngEntries)))

	offset := uint32(6 + 16*len(pngEntries))
	for index, data := range pngEntries {
		size := sizes[index]
		writeByte(file, icoSizeByte(size))
		writeByte(file, icoSizeByte(size))
		writeByte(file, 0)
		writeByte(file, 0)
		writeUint16(file, 1)
		writeUint16(file, 32)
		writeUint32(file, uint32(len(data)))
		writeUint32(file, offset)
		offset += uint32(len(data))
	}

	for _, data := range pngEntries {
		if _, err := file.Write(data); err != nil {
			return err
		}
	}

	return nil
}

func writeByte(writer io.Writer, value byte) {
	_, _ = writer.Write([]byte{value})
}

func writeUint16(writer io.Writer, value uint16) {
	_ = binary.Write(writer, binary.LittleEndian, value)
}

func writeUint32(writer io.Writer, value uint32) {
	_ = binary.Write(writer, binary.LittleEndian, value)
}

func icoSizeByte(size int) byte {
	if size >= 256 {
		return 0
	}
	return byte(size)
}

func normalizeFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "png":
		return "png"
	case "jpg", "jpeg":
		return "jpg"
	case "ico":
		return "ico"
	case "webp":
		return "webp"
	default:
		return ""
	}
}

func extensionForFormat(format string) string {
	if format == "jpeg" {
		return "jpg"
	}
	return format
}

func defaultFileName(inputPath string, job outputJob, format string) string {
	base := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))
	suffix := fallback(job.ID, fmt.Sprintf("%dx%d", job.Width, job.Height))
	suffix = strings.ReplaceAll(suffix, ":", "-")
	return fmt.Sprintf("%s-%s.%s", base, suffix, extensionForFormat(format))
}

func sanitizeFileName(name string) string {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	stem = strings.Trim(unsafeNamePattern.ReplaceAllString(stem, "-"), "-")
	if stem == "" {
		stem = "asset"
	}
	return stem + strings.ToLower(ext)
}

func nextAvailablePath(path string) string {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return path
	}

	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for index := 2; ; index++ {
		next := fmt.Sprintf("%s-%d%s", stem, index, ext)
		if _, err := os.Stat(next); errors.Is(err, os.ErrNotExist) {
			return next
		}
	}
}

func parseHexColor(value string) (color.NRGBA, error) {
	if value == "" {
		return color.NRGBA{A: 0}, nil
	}

	hex := strings.TrimPrefix(strings.TrimSpace(value), "#")
	if len(hex) != 6 && len(hex) != 8 {
		return color.NRGBA{}, fmt.Errorf("background must be #RRGGBB or #RRGGBBAA")
	}

	parsed, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return color.NRGBA{}, err
	}

	if len(hex) == 6 {
		return color.NRGBA{
			R: byte(parsed >> 16),
			G: byte(parsed >> 8),
			B: byte(parsed),
			A: 255,
		}, nil
	}

	return color.NRGBA{
		R: byte(parsed >> 24),
		G: byte(parsed >> 16),
		B: byte(parsed >> 8),
		A: byte(parsed),
	}, nil
}

func fallback(value string, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func clampInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
