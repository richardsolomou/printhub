#include <cmath>
#include <exception>
#include <iomanip>
#include <iostream>
#include <optional>
#include <string>

#include <boost/optional.hpp>

#include "libslic3r/Config.hpp"
#include "libslic3r/FileReader.hpp"
#include "libslic3r/Format/STL.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/SLAPrint.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/libslic3r.h"

namespace {

Slic3r::DynamicPrintConfig sla_config(const Slic3r::DynamicPrintConfig &loaded)
{
    Slic3r::SLAFullPrintConfig config;
    config.output_filename_format.value = "[input_filename_base].sl1";
    const double width = config.display_width.getFloat();
    const double height = config.display_height.getFloat();
    config.bed_shape.values = {Slic3r::Vec2d(0, 0), Slic3r::Vec2d(width, 0), Slic3r::Vec2d(width, height), Slic3r::Vec2d(0, height)};
    config.apply(loaded, true);

    Slic3r::DynamicPrintConfig normalized;
    normalized.apply(config, true);
    normalized.option<Slic3r::ConfigOptionEnum<Slic3r::PrinterTechnology>>("printer_technology", true)->value = Slic3r::ptSLA;
    return normalized;
}

Slic3r::Transform3d instance_transform(const Slic3r::SLAPrintObject::Instance &instance, double elevation)
{
    Slic3r::Transform3d transform = Slic3r::Transform3d::Identity();
    transform.linear() = Eigen::AngleAxisd(instance.rotation, Slic3r::Vec3d::UnitZ()).toRotationMatrix();
    transform.translation() = Slic3r::Vec3d(
        Slic3r::unscale<double>(instance.shift.x()),
        Slic3r::unscale<double>(instance.shift.y()),
        elevation);
    return transform;
}

void add_instances(Slic3r::TriangleMesh &output, const Slic3r::TriangleMesh &source, const Slic3r::SLAPrintObject &object)
{
    if (source.empty())
        return;

    for (const Slic3r::SLAPrintObject::Instance &instance : object.instances()) {
        Slic3r::TriangleMesh mesh = source;
        mesh.transform(instance_transform(instance, object.get_elevation()));
        output.merge(mesh);
    }
}

}

int main(int argc, char **argv)
{
    if (argc != 3) {
        std::cerr << "usage: printhub-support INPUT.3mf OUTPUT.stl\n";
        return 2;
    }

    try {
        Slic3r::DynamicPrintConfig loaded;
        Slic3r::ConfigSubstitutionContext substitutions(Slic3r::ForwardCompatibilitySubstitutionRule::EnableSilent);
        boost::optional<Slic3r::Semver> generator_version;
        Slic3r::Model model = Slic3r::FileReader::load_model_with_config(
            argv[1], &loaded, &substitutions, generator_version, Slic3r::FileReader::LoadAttribute::AddDefaultInstances);
        if (model.objects.empty())
            throw std::runtime_error("project contains no models");

        Slic3r::DynamicPrintConfig config = sla_config(loaded);
        const std::string config_error = config.validate();
        if (!config_error.empty())
            throw std::runtime_error(config_error);

        Slic3r::SLAPrint print;
        print.apply(model, config);
        const std::string print_error = print.validate();
        if (!print_error.empty())
            throw std::runtime_error(print_error);
        if (print.empty())
            throw std::runtime_error("nothing is printable inside the configured build volume");
        print.process();

        Slic3r::TriangleMesh output;
        std::optional<double> elevation;
        for (const Slic3r::SLAPrintObject *object : print.objects()) {
            const double object_elevation = object->get_elevation();
            if (elevation && std::abs(*elevation - object_elevation) > 1e-6)
                throw std::runtime_error("objects require different SLA elevations");
            elevation = object_elevation;
            add_instances(output, object->support_mesh(), *object);
            add_instances(output, object->pad_mesh(), *object);
        }
        if (output.empty())
            throw std::runtime_error("PrusaSlicer generated no support geometry");
        if (!Slic3r::store_stl(argv[2], &output, true))
            throw std::runtime_error("could not write support STL");
        std::cout << std::setprecision(17) << elevation.value_or(0.0) << '\n';
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
